import { BigNumber } from 'bignumber.js';
import { Injectable, Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { JsonDB, Config } from 'node-json-db';
import {
    ethers,
    Interface,
} from 'ethers6';
import MDCAbi from '../abi/MDC.abi.json';
import { ArbitrationDB, ArbitrationTransaction } from './arbitration.interface';
import { HTTPPost, querySubgraph } from '../utils';
import Keyv from 'keyv';
const keyv = new Keyv();

export interface ChainRel {
    id: string;
    nativeToken: string;
    minVerifyChallengeSourceTxSecond: string;
    minVerifyChallengeDestTxSecond: string;
    maxVerifyChallengeSourceTxSecond: string;
    maxVerifyChallengeDestTxSecond: string;
    batchLimit: string;
    enableTimestamp: string;
    latestUpdateHash: string;
    latestUpdateBlockNumber: string;
    latestUpdateTimestamp: string;
    spvs: string[];
}

const arbitrationHost = process.env['ArbitrationHost'];

@Injectable()
export class ArbitrationService {
    public jsondb = new JsonDB(new Config('runtime/arbitrationDB', true, false, '/'));
    private readonly logger: Logger = new Logger(ArbitrationService.name);

    constructor(private schedulerRegistry: SchedulerRegistry) {
    }

    async verifyArbitrationConditions(sourceTx: ArbitrationTransaction): Promise<boolean> {
        // Arbitration time reached
        const chainRels = await this.getChainRels();
        const chain = chainRels.find(c => +c.id === +sourceTx.sourceChainId);
        if (!chain) {
            return false;
        }
        const fromTimestamp = +sourceTx['sourceTxTime'];
        const minVerifyChallengeSourceTime = fromTimestamp + (+chain.minVerifyChallengeSourceTxSecond);
        const maxVerifyChallengeSourceTime = fromTimestamp + (+chain.maxVerifyChallengeSourceTxSecond);
        const nowTime = new Date().valueOf() / 1000;
        return nowTime >= minVerifyChallengeSourceTime && nowTime <= maxVerifyChallengeSourceTime;
    }

    async getMDCAddress(owner: string) {
        const queryStr = `
    {
      mdcs(where: {owner: "${owner}"}) {
        id
        owner
      }
    }
          `;
        const result = await querySubgraph(queryStr);
        return result['mdcs'][0];
    }

    async getChainRels():Promise<ChainRel[]> {
        let chainRels = await keyv.get('ChainRels');
        if (!chainRels) {
            const queryStr = `
        query  {
            chainRels {
            id
            nativeToken
            minVerifyChallengeSourceTxSecond
            minVerifyChallengeDestTxSecond
            maxVerifyChallengeSourceTxSecond
            maxVerifyChallengeDestTxSecond
            batchLimit
            enableTimestamp
            latestUpdateHash
            latestUpdateBlockNumber
            latestUpdateTimestamp
            spvs
            }
      }
          `;
            const result = await querySubgraph(queryStr) || {};
            chainRels = result['chainRels'] || [];
            await keyv.set('ChainRels', chainRels, 1000 * 5);
        }
        return chainRels;
    }

    async handleUserArbitration(tx: ArbitrationTransaction) {
        this.logger.log(`handleUserArbitration begin ${tx.sourceTxHash}`);
        const ifa = new Interface(MDCAbi);
        if (!tx.sourceTxTime) {
            throw new Error('sourceTxTime not found');
        }
        if (!tx.sourceChainId) {
            throw new Error('sourceChainId not found');
        }
        if (!tx.sourceTxBlockNum) {
            throw new Error('sourceTxBlockNum not found');
        }
        if (!tx.sourceTxIndex) {
            throw new Error('sourceTxIndex not found');
        }
        if (!tx.sourceTxHash) {
            throw new Error('sourceTxHash not found');
        }
        if (!tx.ruleKey) {
            throw new Error('ruleKey not found');
        }
        if (!tx.freezeToken) {
            throw new Error('freezeToken not found');
        }
        if (!tx.freezeAmount1) {
            throw new Error('freezeAmount1 not found');
        }
        const account = await this.getWallet();
        const mdcAddress = await this.getMDCAddress(tx.sourceMaker);
        // Obtaining arbitration deposit
        // TODO: Verify Balance
        const data = ifa.encodeFunctionData('challenge', [
            tx.sourceTxTime,
            tx.sourceChainId,
            tx.sourceTxBlockNum,
            tx.sourceTxIndex,
            tx.sourceTxHash,
            tx.ruleKey,
            tx.freezeToken,
            new BigNumber(tx.freezeAmount1),
            tx.parentNodeNumOfTargetNode || 0,
        ]);

        const transactionRequest = {
            data,
            to: mdcAddress,
            value: '0x',
            from: account.address,
        };
        const response: any = await account.populateTransaction(transactionRequest);
        console.log(response, '===tx', transactionRequest);
        await this.jsondb.push(`/arbitrationHash/${tx.sourceTxHash.toLowerCase()}`, {
            fromChainId: tx.sourceChainId,
            sourceTxHash: tx.sourceTxHash.toLowerCase(),
            submitSourceTxHash: response.transactionHash,
            mdcAddress,
            spvAddress: tx.spvAddress,
            status: 0,
        });
        this.logger.log(`handleUserArbitration success ${tx.sourceTxHash} ${response.transactionHash}`);
        await HTTPPost(`${arbitrationHost}/proof/needProofSubmission`, {
            isSource: 1,
            chainId: tx.sourceChainId,
            hash: tx.sourceTxHash,
            mdcAddress,
        });
        return response as any;
    }

    async getWallet() {
        const arbitrationPrivateKey = process.env['ArbitrationPrivateKey'];
        if (!arbitrationPrivateKey) {
            throw new Error('arbitrationPrivateKey not config');
        }
        const chainId = process.env['NODE_ENV'] === 'production' ? '1' : '5';
        const arbitrationRPC = process.env['ArbitrationRPC'];
        if (!arbitrationRPC) {
            throw new Error(`${chainId} arbitrationRPC not config`);
        }
        const provider = new ethers.JsonRpcProvider(arbitrationRPC);
        return new ethers.Wallet(arbitrationPrivateKey).connect(provider);
    }

    async userSubmitProof(txData: ArbitrationDB, proof: string) {
        if (!proof) {
            throw new Error(`proof is empty`);
        }
        const wallet = await this.getWallet();
        const ifa = new Interface(MDCAbi);
        const data = ifa.encodeFunctionData('verifyChallengeSource', [
            txData.challenger,
            txData.spvAddress,
            txData.sourceChainId,
            proof,
            txData.rawDatas,
            txData.rlpRuleBytes,
        ]);
        const transactionRequest = {
            data,
            to: txData.mdcAddress,
            value: '0x',
            from: wallet.address,
        };
        const response: any = await wallet.populateTransaction(transactionRequest);
        console.log(response, '===submitProof tx', transactionRequest);
        await this.jsondb.push(`/arbitrationHash/${txData.sourceTxHash}`, {
            ...txData,
            submitSourceProofHash: response.transactionHash,
            status: 1,
        });
        return response as any;
    }

    async makerSubmitProof(txData: ArbitrationDB, proof: string) {
        if (!proof) {
            throw new Error(`proof is empty`);
        }
        const wallet = await this.getWallet();
        const ifa = new Interface(MDCAbi);

        const chainRels = await this.getChainRels();
        const chain = chainRels.find(c => +c.id === +txData.sourceChainId);
        if (!chain) {
            throw new Error('ChainRels not found');
        }
        const verifiedSourceTxData = [
            +chain.minVerifyChallengeSourceTxSecond,
            +chain.maxVerifyChallengeSourceTxSecond,
            +txData.targetNonce,
            +txData.targetChain,
            +txData.targetFrom,
            +txData.targetToken,
            +txData.targetAmount,
            +txData.responseMakersHash,
            +txData.responseTime,
        ];
        const data = ifa.encodeFunctionData('verifyChallengeDest', [
            txData.challenger,
            txData.spvAddress,
            txData.sourceChainId,
            txData.sourceTxHash,
            proof,
            verifiedSourceTxData,
            txData.rawDatas,
        ]);
        const transactionRequest = {
            data,
            to: txData.mdcAddress,
            value: "0x",
            from: wallet.address,
        };
        const response: any = await wallet.populateTransaction(transactionRequest);
        console.log(response, '===submitProof tx', transactionRequest);
        await this.jsondb.push(`/arbitrationHash/${txData.sourceTxHash}`, {
            ...txData,
            submitSourceProofHash: response.transactionHash,
            status: 1,
        });
        return response as any;
    }
}
