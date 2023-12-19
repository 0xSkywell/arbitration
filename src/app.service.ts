import { Injectable } from '@nestjs/common';
import { ArbitrationService } from './arbitration/arbitration.service';

@Injectable()
export class AppService {
    constructor(private arbitrationService: ArbitrationService) {
    }

    async getData() {
        return await this.arbitrationService.jsondb.getData('/arbitrationHash');
    }
}
