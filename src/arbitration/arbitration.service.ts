import { Injectable, Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { JsonDB, Config } from 'node-json-db';
import { utils, providers, ethers } from 'ethers';
import MDCAbi from '../abi/MDC.abi.json';
import {
    ArbitrationDB,
    ArbitrationTransaction,
    VerifyChallengeDestParams,
    VerifyChallengeSourceParams,
} from './arbitration.interface';
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
        console.log('getMDCAddress', result?.data?.mdcs?.[0]?.id);
        return result?.data?.mdcs?.[0]?.id;
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
            chainRels = result?.data?.chainRels || [];
            await keyv.set('ChainRels', chainRels, 1000 * 5);
        }
        return chainRels;
    }

    async getJSONDBData(dataPath) {
        try {
            return await this.jsondb.getData(dataPath);
        } catch (e) {
            return null;
        }
    }

    async getGasPrice(transactionRequest: any) {
        const arbitrationRPC = process.env['ArbitrationRPC'];
        const provider = new providers.JsonRpcProvider({
            url: arbitrationRPC,
        });
        transactionRequest.gasLimit = ethers.BigNumber.from(210000);
        // try {
        //     transactionRequest.gasLimit = transactionRequest.data ? await provider.estimateGas({
        //         from: transactionRequest.from,
        //         to: transactionRequest.to,
        //         value: transactionRequest.value,
        //         data: transactionRequest.data,
        //     }) : await provider.estimateGas({
        //         from: transactionRequest.from,
        //         to: transactionRequest.to,
        //         value: transactionRequest.value,
        //     });
        // } catch (e) {
        //     this.logger.error(`transfer estimateGas error`, e.message);
        // }


        try {
            const feeData = await provider.getFeeData();
            if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
                transactionRequest.type = 2;
                transactionRequest.maxFeePerGas = feeData.maxFeePerGas;
                transactionRequest.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
                delete transactionRequest.gasPrice;
                this.logger.log(`EIP1559 use maxFeePerGas: ${String(transactionRequest.maxFeePerGas)}, maxPriorityFeePerGas: ${String(transactionRequest.maxPriorityFeePerGas)}, gasLimit: ${String(transactionRequest.gasLimit)}`);
            } else {
                transactionRequest.gasPrice = feeData.gasPrice;
                this.logger.log(`Legacy use gasPrice: ${String(transactionRequest.gasPrice)}, gasLimit: ${String(transactionRequest.gasLimit)}`);
            }
        } catch (e) {
            this.logger.error('get gas price error:', e);
        }
    }

    async handleUserArbitration(tx: ArbitrationTransaction) {
        this.logger.log(`handleUserArbitration begin ${tx.sourceTxHash}`);
        const ifa = new ethers.utils.Interface(MDCAbi);
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
        const encodeData = [
            +tx.sourceTxTime,
            +tx.sourceChainId,
            +tx.sourceTxBlockNum,
            +tx.sourceTxIndex,
            tx.sourceTxHash,
            tx.ruleKey,
            tx.freezeToken,
            +tx.freezeAmount1,
            +tx.parentNodeNumOfTargetNode || 0,
        ];
        console.log('encodeData', encodeData);
        const data = ifa.encodeFunctionData('challenge', encodeData);

        const arbitrationRPC = process.env['ArbitrationRPC'];
        const provider = new providers.JsonRpcProvider({
            url: arbitrationRPC,
        });
        const chainId = await account.getChainId();
        const transactionRequest = {
            chainId,
            data,
            to: mdcAddress,
            value: 0n,
            from: account.address,
            nonce: await account.getTransactionCount('pending'),
        };
        await this.getGasPrice(transactionRequest);
        console.log('transactionRequest', transactionRequest);

        const signedTx = await account.signTransaction(transactionRequest);
        const txHash = utils.keccak256(signedTx);
        this.logger.log(`txHash: ${txHash}`);
        const response = await provider.sendTransaction(signedTx);
        this.logger.log(`handleUserArbitration tx: ${JSON.stringify(response)}`);
        await this.jsondb.push(`/arbitrationHash/${tx.sourceTxHash.toLowerCase()}`, {
            fromChainId: tx.sourceChainId,
            submitSourceTxHash: response.hash,
            status: 0,
        });
        this.logger.log(`handleUserArbitration success ${tx.sourceTxHash} ${response.hash}`);
        const res = await HTTPPost(`${process.env['ArbitrationHost']}/proof/userAskProof`, {
            isSource: 1,
            chainId: tx.sourceChainId,
            hash: tx.sourceTxHash,
            mdcAddress,
            challenger: account.address,
            spvAddress: tx.spvAddress,
        });
        this.logger.log(`userAskProof ${JSON.stringify(res)}`);
        // return response as any;
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
        const provider = new providers.JsonRpcProvider({
            url: arbitrationRPC,
        });
        // const provider = new ethers.JsonRpcProvider(arbitrationRPC);
        return new ethers.Wallet(arbitrationPrivateKey).connect(provider);
    }

    async userSubmitProof(txData: VerifyChallengeSourceParams) {
        if (!txData.proof) {
            throw new Error(`proof is empty`);
        }
        const wallet = await this.getWallet();
        const mdcAddress = await this.getMDCAddress(txData.sourceMaker);
        const ifa = new ethers.utils.Interface(MDCAbi);
        const data = ifa.encodeFunctionData('verifyChallengeSource', [
            wallet.address,
            txData.spvAddress,
            +txData.sourceChain,
            txData.proof,
            txData.rawDatas,
            txData.rlpRuleBytes,
        ]);
        const transactionRequest = {
            data,
            to: mdcAddress,
            value: 0n,
            from: wallet.address,
        };
        const response: any = await wallet.populateTransaction(transactionRequest);
        this.logger.log(`submitProof tx: ${response}`);
        await this.jsondb.push(`/arbitrationHash/${txData.hash}`, {
            ...txData,
            submitSourceProofHash: response.transactionHash,
            status: 1,
        });
        return response as any;
    }

    async makerSubmitProof(txData: VerifyChallengeDestParams) {
        if (!txData.proof) {
            throw new Error(`proof is empty`);
        }
        const wallet = await this.getWallet();
        const ifa = new ethers.utils.Interface(MDCAbi);

        const chainRels = await this.getChainRels();
        const mdcAddress = await this.getMDCAddress(txData.sourceMaker);
        const chain = chainRels.find(c => +c.id === +txData.sourceChain);
        if (!chain) {
            throw new Error('ChainRels not found');
        }
        const verifiedSourceTxData = [
            +chain.minVerifyChallengeSourceTxSecond,
            +chain.maxVerifyChallengeSourceTxSecond,
            +txData.targetNonce,
            +txData.targetChain,
            +txData.targetAddress,
            +txData.targetToken,
            +txData.targetAmount,
            +txData.responseMakersHash,
            +txData.responseTime,
        ];
        const data = ifa.encodeFunctionData('verifyChallengeDest', [
            txData.challenger,
            txData.spvAddress,
            txData.sourceChain,
            txData.sourceId,
            txData.proof,
            verifiedSourceTxData,
            txData.rawDatas,
        ]);
        const transactionRequest = {
            data,
            to: mdcAddress,
            value: "0x",
            from: wallet.address,
        };
        const response: any = await wallet.populateTransaction(transactionRequest);
        this.logger.log('===submitProof tx', response);
        await this.jsondb.push(`/arbitrationHash/${txData.sourceId}`, {
            ...txData,
            submitSourceProofHash: response.transactionHash,
            status: 1,
        });
        return response as any;
    }
}
