import { Injectable } from '@nestjs/common';
import { Cron, Interval } from '@nestjs/schedule';
import { Mutex } from 'async-mutex';
import { ArbitrationService } from './arbitration.service';
import { ArbitrationTransaction } from './arbitration.interface';
import { HTTPGet, HTTPPost } from '../utils';
import logger from '../utils/logger';
import { arbitrationConfig } from '../utils/config';

const mutex = new Mutex();
const proofMutex = new Mutex();
let startTime = new Date().valueOf();

// arbitration-client
@Injectable()
export class ArbitrationJobService {
    constructor(private arbitrationService: ArbitrationService) {
    }

    @Interval(1000 * 60)
    async syncProof() {
        if (!arbitrationConfig.privateKey) {
            console.log('Private key not injected', arbitrationConfig);
            return;
        }
        const isMaker = !!arbitrationConfig.makerList;
        if (proofMutex.isLocked()) {
            return;
        }
        await proofMutex.runExclusive(async () => {
            try {
                const currentSourceTxHashList: string[] = [];
                if (isMaker && arbitrationConfig.makerList instanceof Array) {
                    for (const owner of arbitrationConfig.makerList) {
                        const hash = await this.arbitrationService.getCurrentChallengeHash(owner);
                        if (hash) {
                            currentSourceTxHashList.push(hash);
                        }
                    }
                }
                const arbitrationObj = await this.arbitrationService.getJSONDBData(`/arbitrationHash`);
                for (const hash in arbitrationObj) {
                    if (isMaker) {
                        const currentSourceTxHash = currentSourceTxHashList.find(item => item.toLowerCase() === String(hash).toLowerCase());
                        if (!currentSourceTxHash) continue;
                        logger.info(`createChallenges sourceTxHash ${currentSourceTxHash}`);
                    }
                    if (arbitrationObj[hash] && !arbitrationObj[hash].isNeedProof) continue;
                    const url = `${arbitrationConfig.makerApiEndpoint}/proof/${isMaker ? 'verifyChallengeDestParams' : 'verifyChallengeSourceParams'}/${hash}`;
                    const result: any = await HTTPGet(url);
                    // logger.input(`syncProof === ${url}`);
                    const proofDataList: any[] = result?.data;
                    if (!proofDataList.length) continue;
                    const proofData = proofDataList.find(item => item.status);
                    if (proofData) {
                        if (!proofData?.proof) {
                            continue;
                        }
                        if (isMaker) {
                            await this.arbitrationService.makerSubmitProof({
                                ...proofData,
                                challenger: arbitrationObj[hash].challenger,
                            });
                        } else {
                            await this.arbitrationService.userSubmitProof({
                                ...proofData,
                                challenger: arbitrationObj[hash].challenger,
                                submitSourceTxHash: arbitrationObj[hash].submitSourceTxHash,
                            });
                        }
                        await new Promise(resolve => setTimeout(resolve, 3000));
                    }
                }
            } catch (e) {
                logger.error('syncProof error', e);
            }
        });
    }

    @Cron('*/30 * * * * *', {
        name: 'userArbitrationJob',
    })
    getListOfUnrefundedTransactions() {
        if (!arbitrationConfig.privateKey) {
            return;
        }
        if (arbitrationConfig.makerList) {
            return;
        }
        if (mutex.isLocked()) {
            return;
        }
        mutex.runExclusive(async () => {
            try {
                const endTime = new Date().valueOf();
                const url = `${arbitrationConfig.makerApiEndpoint}/transaction/unreimbursedTransactions?startTime=${startTime - 1000 * 60 * 60}&endTime=${endTime}`;
                const res: any = await HTTPGet(url);
                // logger.input(`userArbitrationJob === ${url}`);
                if (res?.data) {
                    const list: ArbitrationTransaction[] = res.data;
                    for (const item of list) {
                        const result = await this.arbitrationService.verifyArbitrationConditions(item);
                        if (result) {
                            const data = await this.arbitrationService.getJSONDBData(`/arbitrationHash/${item.sourceTxHash.toLowerCase()}`);
                            if (data) {
                                logger.debug('tx exist', item.sourceTxHash.toLowerCase());
                                continue;
                            }
                            await this.arbitrationService.jsondb.push(`/arbitrationHash/${item.sourceTxHash.toLowerCase()}`, { isNeedProof: 0 });
                            try {
                                await this.arbitrationService.handleUserArbitration(item);
                            } catch (error) {
                                logger.error('Arbitration encountered an exception', item, error);
                            }
                            await new Promise(resolve => setTimeout(resolve, 3000));
                        }
                    }
                    startTime = endTime;
                }
            } catch (e) {
                console.error('userArbitrationJob error', e);
            }
        });
    }

    @Cron('*/30 * * * * *', {
        name: 'makerArbitrationJob',
    })
    getListOfUnresponsiveTransactions() {
        if (!arbitrationConfig.privateKey) {
            return;
        }
        if (!arbitrationConfig.makerList) {
            return;
        }
        const makerList = arbitrationConfig.makerList;
        if (mutex.isLocked()) {
            return;
        }
        mutex.runExclusive(async () => {
            try {
                for (const makerAddress of makerList) {
                    const challengerList = await this.arbitrationService.getVerifyPassChallenger(makerAddress);
                    for (const challengerData of challengerList) {
                        const hash = challengerData.sourceTxHash.toLowerCase();
                        const data = await this.arbitrationService.getJSONDBData(`/arbitrationHash/${hash}`);
                        if (data) {
                            logger.debug('tx exist', hash);
                            continue;
                        }
                        const txStatusRes = await HTTPGet(`${arbitrationConfig.makerApiEndpoint}/transaction/status/${hash}`, {
                            hash,
                        });
                        if (txStatusRes?.data !== 99) {
                            console.log('txStatusRes', txStatusRes);
                            continue;
                        }
                        const res = await HTTPPost(`${arbitrationConfig.makerApiEndpoint}/proof/makerAskProof`, {
                            hash,
                        });
                        logger.info('maker request ask', JSON.stringify(res));
                        await this.arbitrationService.jsondb.push(`/arbitrationHash/${hash}`, {
                            isNeedProof: 1,
                            challenger: challengerData.verifyPassChallenger,
                        });
                        logger.info(`maker ask proof ${hash}`);
                        await new Promise(resolve => setTimeout(resolve, 3000));
                    }
                }
            } catch (e) {
                console.error('makerArbitrationJob error', e);
            }
        });
    }
}
