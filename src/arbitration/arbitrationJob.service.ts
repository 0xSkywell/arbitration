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
        console.log('syncProof ====', isMaker);
        if (proofMutex.isLocked()) {
            return;
        }
        proofMutex
            .runExclusive(async () => {
                const arbitrationObj = await this.arbitrationService.getJSONDBData(`/arbitrationHash`);
                for (const hash in arbitrationObj) {
                    if (arbitrationObj[hash] && arbitrationObj[hash].status) continue;
                    const url = `${process.env['ArbitrationHost']}/proof/${isMaker ? 'targetId' : 'sourceId'}/${hash}`;
                    const result: any = await HTTPGet(url);
                    console.log(result, '=== syncProof result', url);
                    const proofData: any = result?.data;
                    if (proofData) {
                        if (!proofData.status) {
                            logger.error(`async proof: ${JSON.stringify(proofData)}`);
                            await this.arbitrationService.jsondb.push(`/arbitrationHash/${hash.toLowerCase()}`, {
                                message: proofData.message,
                                status: 1,
                            });
                            continue;
                        }
                        if (!proofData?.proof) {
                            continue;
                        }
                        if (isMaker) {
                            await this.arbitrationService.makerSubmitProof(proofData);
                        } else {
                            await this.arbitrationService.userSubmitProof(proofData);
                        }
                    }
                }
            });
    }

    @Cron('*/5 * * * * *', {
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
        mutex
            .runExclusive(async () => {
                try {
                    const endTime = new Date().valueOf();
                    const res: any = await HTTPGet(`${process.env['ArbitrationHost']}/transaction/unreimbursedTransactions?startTime=${startTime - 1000 * 60 * 60 * 24}&endTime=${endTime}`);
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
                                await this.arbitrationService.jsondb.push(`/arbitrationHash/${item.sourceTxHash.toLowerCase()}`, {});
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
                    console.error('userArbitrationJob error', e.message);
                }
            });
    }

    @Cron('*/5 * * * * *', {
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
        mutex
            .runExclusive(async () => {
                const account = await this.arbitrationService.getWallet();
                const res: any[] = <any[]>await HTTPGet(`${process.env['ArbitrationHost']}/proof/makerNeedResponseTxList?makerAddress=${account.address.toLowerCase()}`);
                for (const item of res) {
                    if (!makerList.find(maker => maker.toLowerCase() === item.makerAddress.toLowerCase())) {
                        continue;
                    }
                    const result = this.arbitrationService.verifyArbitrationConditions(item as ArbitrationTransaction);
                    if (result) {
                        const data = await this.arbitrationService.getJSONDBData(`/arbitrationHash/${item.hash.toLowerCase()}`);
                        if (data) {
                            logger.debug('tx exist', item.hash.toLowerCase());
                            continue;
                        }
                        const userSubmitTx = {
                            hash: item.hash,
                            challenger: item.challenger,
                        };
                        await this.arbitrationService.jsondb.push(`/arbitrationHash/${item.hash.toLowerCase()}`, userSubmitTx);
                        logger.info(`maker response arbitration ${item.targetChain} ${item.hash}`);
                        await HTTPPost(`${process.env['ArbitrationHost']}/proof/makerAskProof`, {
                            isSource: 0,
                            chainId: item.targetChain,
                            hash: item.hash,
                        });
                    }
                }
            });
    }
}
