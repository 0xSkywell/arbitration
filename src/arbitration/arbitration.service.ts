import { Injectable } from '@nestjs/common';
import { JsonDB, Config } from 'node-json-db';
import { utils, providers, ethers } from 'ethers';
import MDCAbi from '../abi/MDC.abi.json';
import {
    ArbitrationTransaction,
    VerifyChallengeDestParams,
    VerifyChallengeSourceParams,
} from './arbitration.interface';
import { HTTPPost, querySubgraph } from '../utils';
import Keyv from 'keyv';
import BigNumber from 'bignumber.js';
import logger from '../utils/logger';

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
        return result?.data?.mdcs?.[0]?.id;
    }

    async getChainRels(): Promise<ChainRel[]> {
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

    async getChallengeNodeNumber(owner: string, mdcAddress: string, newChallengeNodeNumber: string) {
        const queryStr = `
        {
            createChallenges(
                where: {
                    challengeNodeNumber_gt: "${newChallengeNodeNumber}"
                    challengeManager_: {
                        owner: "${owner}"
                        mdcAddr: "${mdcAddress}"
                    }
                }
                orderBy: challengeNodeNumber
                orderDirection: asc
                first: 1
            ) {
                challengeNodeNumber
            }
        }
          `;
        const result = await querySubgraph(queryStr);
        return result?.data?.createChallenges?.[0]?.challengeNodeNumber;
    }

    async getResponseMakerList(sourceTime: string) {
        const queryStr = `
            {
              mdcs (
                where:{
                  responseMakersSnapshot_:{
                  enableTimestamp_lt:"${sourceTime}"
              }}){
                responseMakersSnapshot {
                  responseMakerList
                }
              }
            }
          `;
        const result = await querySubgraph(queryStr);
        return result?.data?.responseMakersSnapshot?.[0]?.responseMakerList || [];
    }

    async getVerifyPassChallenger(owner: string) {
        const queryStr = `
                {
                  challengeManagers (where:{
                    owner:"${owner.toLowerCase()}"
                  }){
                    owner
                    verifyPassChallenger
                    challengeStatuses
                    createChallenge {
                      sourceTxHash
                      isVerifyPass
                    }
                  }
                }
          `;
        const result = await querySubgraph(queryStr);
        const challengerList = result?.data?.challengeManagers;
        if (!challengerList) return [];
        const list = [];
        for (const challenger of challengerList) {
            if (challenger.challengeStatuses !== 'VERIFY_SOURCE') continue;
            const verifyPassChallenger = challenger.verifyPassChallenger;
            if (!challenger.createChallenge || !verifyPassChallenger) continue;
            const sourceTxHash = (challenger.createChallenge.find(item => item.isVerifyPass))?.sourceTxHash;
            if (!sourceTxHash) continue;
            list.push({ verifyPassChallenger, sourceTxHash });
        }
        return list;
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
        if (process.env['GasLimit']) {
            transactionRequest.gasLimit = ethers.BigNumber.from(process.env['GasLimit']);
        } else {
            transactionRequest.gasLimit = ethers.BigNumber.from(10000000);
        }

        // try {
        //     transactionRequest.gasLimit = await provider.estimateGas({
        //         from: transactionRequest.from,
        //         to: transactionRequest.to,
        //         data: transactionRequest.data,
        //         value: transactionRequest.value,
        //     });
        // } catch (e) {
        //     logger.error('get gas limit error:', e);
        // }

        if (process.env['MaxFeePerGas'] && process.env['MaxPriorityFeePerGas']) {
            transactionRequest.type = 2;
            transactionRequest.maxFeePerGas = ethers.BigNumber.from(process.env['MaxFeePerGas']);
            transactionRequest.maxPriorityFeePerGas = ethers.BigNumber.from(process.env['MaxPriorityFeePerGas']);
        } else {
            try {
                const feeData = await provider.getFeeData();
                if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
                    transactionRequest.type = 2;
                    transactionRequest.maxFeePerGas = process.env['MaxFeePerGas'] || feeData.maxFeePerGas;
                    transactionRequest.maxPriorityFeePerGas = process.env['MaxPriorityFeePerGas'] || feeData.maxPriorityFeePerGas;
                    delete transactionRequest.gasPrice;
                } else {
                    transactionRequest.gasPrice = Math.max(1500000000, +feeData.gasPrice);
                    logger.info(`Legacy use gasPrice: ${String(transactionRequest.gasPrice)}, gasLimit: ${String(transactionRequest.gasLimit)}`);
                }
            } catch (e) {
                logger.error('get gas price error:', e);
            }
        }

        const gasFee = new BigNumber(String(transactionRequest.gasLimit)).multipliedBy(String(transactionRequest.maxPriorityFeePerGas || 0));
        logger.info(`maxFeePerGas: ${String(transactionRequest.maxFeePerGas)}, maxPriorityFeePerGas: ${String(transactionRequest.maxPriorityFeePerGas)}, gasLimit: ${String(transactionRequest.gasLimit)}`);

        const balance = await provider.getBalance(transactionRequest.from);
        if (new BigNumber(String(balance)).lt(gasFee)) {
            logger.error(`Insufficient Balance: ${String(balance)} < ${String(gasFee)}`);
            throw new Error('Insufficient Balance');
        }

        return gasFee;
    }

    async getWallet() {
        const arbitrationPrivateKey = process.env['ArbitrationPrivateKey'];
        if (!arbitrationPrivateKey) {
            throw new Error('arbitrationPrivateKey not config');
        }
        const chainId = process.env['MAIN_NETWORK'] || '1';
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

    async send(to, value, data) {
        const account = await this.getWallet();
        const chainId = await account.getChainId();
        const transactionRequest = {
            chainId,
            data,
            to,
            value,
            from: account.address,
            nonce: await account.getTransactionCount('pending'),
        };

        const provider = new providers.JsonRpcProvider({
            url: process.env['ArbitrationRPC'],
        });
        await this.getGasPrice(transactionRequest);
        logger.debug(`transactionRequest: ${JSON.stringify(transactionRequest)}`);
        const signedTx = await account.signTransaction(transactionRequest);
        const txHash = utils.keccak256(signedTx);
        logger.info(`txHash: ${txHash}`);
        return await provider.sendTransaction(signedTx);
    }

    async handleUserArbitration(tx: ArbitrationTransaction) {
        logger.info(`handleUserArbitration begin ${tx.sourceTxHash}`);
        const ifa = new ethers.utils.Interface(MDCAbi);
        const account = await this.getWallet();
        const mdcAddress = await this.getMDCAddress(tx.sourceMaker);
        const newChallengeNodeNumber = utils.defaultAbiCoder.encode(
            ['uint64', 'uint64', 'uint64', 'uint64'],
            [+tx.sourceTxTime, +tx.sourceChainId, +tx.sourceTxBlockNum, +tx.sourceTxIndex],
        );
        const parentNodeNumOfTargetNode = await this.getChallengeNodeNumber(tx.sourceMaker, mdcAddress, newChallengeNodeNumber);
        console.log('parentNodeNumOfTargetNode',parentNodeNumOfTargetNode)
        // Obtaining arbitration deposit
        const encodeData = [
            +tx.sourceTxTime,
            +tx.sourceChainId,
            +tx.sourceTxBlockNum,
            +tx.sourceTxIndex,
            tx.sourceTxHash,
            tx.ruleKey,
            tx.freezeToken,
            ethers.BigNumber.from(tx.freezeAmount1).toNumber(),
            ethers.BigNumber.from(parentNodeNumOfTargetNode || 0),
        ];
        logger.debug(`encodeData: ${JSON.stringify(encodeData)}`);
        const data = ifa.encodeFunctionData('challenge', encodeData);
        const sendValue =
            tx.freezeToken === '0x0000000000000000000000000000000000000000' ?
            ethers.BigNumber.from(new BigNumber(tx.freezeAmount1).plus(tx.minChallengeDepositAmount || 0).toString()) :
            ethers.BigNumber.from(0);
        const response = await this.send(mdcAddress, sendValue, data);
        logger.debug(`handleUserArbitration tx: ${JSON.stringify(response)}`);
        await this.jsondb.push(`/arbitrationHash/${tx.sourceTxHash.toLowerCase()}`, {
            fromChainId: tx.sourceChainId,
            submitSourceTxHash: response.hash,
            isNeedProof: 1
        });
        logger.info(`handleUserArbitration success ${tx.sourceTxHash} ${response.hash}`);
    }

    async userSubmitProof(txData: VerifyChallengeSourceParams) {
        if (!txData.proof) {
            logger.error('proof is empty');
            return;
        }
        logger.info(`userSubmitProof begin ${txData.hash}`);
        const wallet = await this.getWallet();
        const mdcAddress = await this.getMDCAddress(txData.sourceMaker);
        const ifa = new ethers.utils.Interface(MDCAbi);
        const encodeData = [
            wallet.address,
            txData.spvAddress,
            +txData.sourceChain,
            txData.proof,
            txData.rawDatas,
            txData.rlpRuleBytes
        ];
        logger.debug(`encodeData: ${JSON.stringify(encodeData)}`);
        const data = ifa.encodeFunctionData('verifyChallengeSource', encodeData);
        const response = await this.send(mdcAddress, ethers.BigNumber.from(0), data);
        logger.debug(`UserSubmitProof tx: ${JSON.stringify(response)}`);
        await this.jsondb.push(`/arbitrationHash/${txData.hash}`, {
            verifyChallengeSourceHash: response.hash,
            isNeedProof: 0
        });
        logger.info(`userSubmitProof end ${txData.hash} ${response.hash}`);
        return response as any;
    }

    async makerSubmitProof(txData: VerifyChallengeDestParams) {
        if (!txData.proof) {
            logger.error('proof is empty');
            return;
        }
        logger.info(`makerSubmitProof begin sourceId: ${txData.sourceId}`);
        const ifa = new ethers.utils.Interface(MDCAbi);
        const chainRels = await this.getChainRels();
        const mdcAddress = await this.getMDCAddress(txData.sourceMaker);
        const chain = chainRels.find(c => +c.id === +txData.sourceChain);
        if (!chain) {
            throw new Error('ChainRels not found');
        }
        const responseMakerList = await this.getResponseMakerList(txData.sourceTime);
        const rawDatas = utils.defaultAbiCoder.encode(
            ['uint256[]'],
            [responseMakerList.map(item => ethers.BigNumber.from(item))],
        );
        const responseMakersHash = utils.keccak256(rawDatas);
        const responseTime = txData.sourceTime;

        const verifiedSourceTxData = [
            ethers.BigNumber.from(chain.minVerifyChallengeSourceTxSecond),
            ethers.BigNumber.from(chain.maxVerifyChallengeSourceTxSecond),
            ethers.BigNumber.from(txData.targetNonce),
            ethers.BigNumber.from(txData.targetChain),
            ethers.BigNumber.from(txData.targetAddress),
            ethers.BigNumber.from(txData.targetToken),
            ethers.BigNumber.from(txData.targetAmount),
            ethers.BigNumber.from(responseMakersHash),
            responseTime,
        ];
        const encodeData = [
            txData.challenger,
            txData.spvAddress,
            txData.sourceChain,
            txData.sourceId,
            txData.proof,
            verifiedSourceTxData,
            rawDatas,
        ];
        logger.debug(`encodeData: ${JSON.stringify(encodeData)}`);
        const data = ifa.encodeFunctionData('verifyChallengeDest', encodeData);
        const response = await this.send(mdcAddress, ethers.BigNumber.from(0), data);
        logger.debug(`MakerSubmitProof tx: ${JSON.stringify(response)}`);
        await this.jsondb.push(`/arbitrationHash/${txData.sourceId}`, {
            verifyChallengeDestHash: response.hash,
            isNeedProof: 0
        });
        logger.info(`makerSubmitProof end sourceId: ${txData.sourceId} verifyChallengeDestHash: ${response.hash}`);
        return response as any;
    }
}
