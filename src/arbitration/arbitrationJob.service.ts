import { Injectable, Logger } from '@nestjs/common';
import { Cron, Interval } from '@nestjs/schedule';
import { Mutex } from 'async-mutex';
import { ArbitrationService } from './arbitration.service';
import { ArbitrationTransaction } from './arbitration.interface';
import { HTTPGet, HTTPPost } from '../utils';
import logger from '../utils/logger';

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
        const isMaker = !!process.env['MakerList'];
        if (proofMutex.isLocked()) {
            return;
        }
        await proofMutex.runExclusive(async () => {
            try {
                const arbitrationObj = await this.arbitrationService.getJSONDBData(`/arbitrationHash`);
                for (const hash in arbitrationObj) {
                    if (arbitrationObj[hash] && !arbitrationObj[hash].isNeedProof) continue;
                    const url = `${process.env['ArbitrationHost']}/proof/${isMaker ? 'verifyChallengeDestParams' : 'verifyChallengeSourceParams'}/${hash}`;
                    const result: any = await HTTPGet(url);
                    logger.debug(`curl === ${url}`);
                    const proofDataList: any[] = result?.data;
                    if (!proofDataList.length) continue;
                    logger.debug(`async proof: ${JSON.stringify(proofDataList)}`);
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
                            await this.arbitrationService.userSubmitProof(proofData);
                        }
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
        if (process.env['MakerList']) {
            return;
        }
        logger.debug('exec userArbitrationJob');
        if (mutex.isLocked()) {
            return;
        }
        mutex.runExclusive(async () => {
            try {
                const endTime = new Date().valueOf();
                const url = `${process.env['ArbitrationHost']}/transaction/unreimbursedTransactions?startTime=${startTime - 1000 * 60 * 60}&endTime=${endTime}`;
                const res: any = await HTTPGet(url);
                logger.debug('curl', url);
                if (res?.data) {
                    const list: ArbitrationTransaction[] = res.data;
                    logger.debug('list count', list.length);
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
                                logger.error('Arbitration encountered an exception', error);
                            }

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
        if (!process.env['MakerList']) {
            return;
        }
        const makerList = process.env['MakerList'].split(',');
        logger.debug('exec makerArbitrationJob');
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
                        await this.arbitrationService.jsondb.push(`/arbitrationHash/${hash}`, {
                            isNeedProof: 1,
                            challenger: challengerData.verifyPassChallenger,
                        });
                        logger.info(`maker ask proof ${hash}`);
                        await HTTPPost(`${process.env['ArbitrationHost']}/proof/makerAskProof`, {
                            hash,
                        });
                    }
                }
            } catch (e) {
                console.error('makerArbitrationJob error', e);
            }
        });
    }
}
