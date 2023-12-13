import { Injectable, Logger } from '@nestjs/common';
import { Cron, Interval } from '@nestjs/schedule';
import { Mutex } from 'async-mutex';
import { ArbitrationService } from './arbitration.service';
import { ArbitrationDB, ArbitrationTransaction } from './arbitration.interface';
import { HTTPGet, HTTPPost } from '../utils';

const mutex = new Mutex();
let startTime = new Date().valueOf();

// arbitration-client
@Injectable()
export class ArbitrationJobService {
    private readonly logger: Logger = new Logger(ArbitrationJobService.name);

    constructor(private arbitrationService: ArbitrationService) {
    }

    @Interval(1000 * 60)
    async syncProof() {
        const isMaker = !!process.env['MakerList'];
        console.log('syncProof ====', isMaker);
        const arbitrationObj = await this.arbitrationService.getJSONDBData(`/arbitrationHash`);
        for (const hash in arbitrationObj) {
            if (arbitrationObj[hash] && arbitrationObj[hash].status) continue;
            const result: any = await HTTPGet(`${process.env['ArbitrationHost']}/proof/hash/${hash}`);
            console.log(result, '=== syncProof result', `${process.env['ArbitrationHost']}/proof/hash/${hash}`);
            const proofData: any = result?.data;
            if (proofData) {
                if (!proofData.status) {
                    this.logger.error(`async proof message: ${proofData.message}`);
                }
                if(!proofData?.proof){
                    continue;
                }
                if (isMaker) {
                    await this.arbitrationService.makerSubmitProof(arbitrationObj[hash], proofData.proof);
                } else {
                    await this.arbitrationService.userSubmitProof(arbitrationObj[hash], proofData.proof);
                }
            }
        }
    }

    @Cron('*/5 * * * * *', {
        name: 'userArbitrationJob',
    })
    getListOfUnrefundedTransactions() {
        if (process.env['MakerList']) {
            return;
        }
        console.log('exec userArbitrationJob');
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
                                    console.log('tx exist', item.sourceTxHash.toLowerCase());
                                    continue;
                                }
                                await this.arbitrationService.jsondb.push(`/arbitrationHash/${item.sourceTxHash.toLowerCase()}`, {});
                                try {
                                    await this.arbitrationService.handleUserArbitration(item);
                                } catch (error) {
                                    console.error('error',error)
                                    this.logger.error('Arbitration encountered an exception', error);
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
        this.logger.debug('Called when the current second is 45');
        if (mutex.isLocked()) {
            return;
        }
        mutex
            .runExclusive(async () => {
                const res: any[] = <any[]>await HTTPGet(`${process.env['ArbitrationHost']}/proof/needResponseTransactionList`);
                for (const item of res) {
                    if (!makerList.find(maker => maker.toLowerCase() === item.makerAddress.toLowerCase())) {
                        continue;
                    }
                    const result = this.arbitrationService.verifyArbitrationConditions(item as ArbitrationTransaction);
                    if (result) {
                        const data = await this.arbitrationService.getJSONDBData(`/arbitrationHash/${item.hash.toLowerCase()}`);
                        if (data) {
                            console.log('tx exist', item.hash.toLowerCase());
                            continue;
                        }
                        const arbitrationData: ArbitrationDB = {
                            proof: item.proof,
                            targetTxHash: item.hash,
                            mdcAddress: item.mdcAddress,
                            makerAddress: item.makerAddress,
                            isSource: item.isSource,
                            sourceChain: item.sourceChain,
                            targetChain: item.targetChain,
                            challenger: item.challenger,
                            spvAddress: item.spvAddress,
                            rawDatas: item.rawDatas,
                            rlpRuleBytes: item.rlpRuleBytes,
                            targetNonce: item.targetNonce,
                            targetFrom: item.targetFrom,
                            targetToken: item.targetToken,
                            targetAmount: item.targetAmount,
                            responseMakersHash: item.responseMakersHash,
                            responseTime: item.responseTime,
                            sourceTxHash: item.hash.toLowerCase(),
                            status: 0,
                        };
                        await this.arbitrationService.jsondb.push(`/arbitrationHash/${item.hash.toLowerCase()}`, arbitrationData);
                        this.logger.log(`maker response arbitration ${item.targetChain} ${item.hash}`);
                        await HTTPPost(`${process.env['ArbitrationHost']}/proof/needProofSubmission`, {
                            isSource: 0,
                            chainId: item.targetChain,
                            hash: item.hash,
                        });
                    }
                }
            });
    }
}
