import { Injectable } from '@nestjs/common';
import { ethers, providers } from 'ethers';
import { ArbitrationService } from './arbitration/arbitration.service';
import { aesEncrypt, HTTPGet } from './utils';
import logger from './utils/logger';

@Injectable()
export class AppService {
    constructor(private arbitrationService: ArbitrationService) {
    }

    async setConfig(configParams: any) {
        const { privateKey, secretKey, rpc, makerApiEndpoint, makerList, gasLimit, maxFeePerGas, maxPriorityFeePerGas } = configParams;
        if (rpc) {
            try {
                const provider = new providers.JsonRpcProvider({
                    url: rpc,
                });
                const rpcNetwork = await provider.getNetwork();
                if (+rpcNetwork.chainId !== 11155111 && +rpcNetwork.chainId !== 1) {
                    return { code: 1, message: 'Currently only the main and sepolia networks are supported' };
                }
            } catch (e) {
                return { code: 1, message: 'Rpc error' };
            }
            this.arbitrationService.config.rpc = rpc;
        }
        if (privateKey) {
            if (this.arbitrationService.config.rpc) {
                try {
                    const provider = new providers.JsonRpcProvider({
                        url: this.arbitrationService.config.rpc,
                    });
                    const wallet = new ethers.Wallet(privateKey).connect(provider);
                    const address = wallet.getAddress();
                    console.log(`Inject the ${address} wallet private key`);
                    this.arbitrationService.config.secretKey = secretKey ?? this.arbitrationService.config.secretKey;
                    this.arbitrationService.config.privateKey = privateKey;
                } catch (e) {
                    return { code: 1, message: 'PrivateKey error' };
                }
            }
        }
        if (makerList) {
            this.arbitrationService.config.makerList = makerList;
        }
        if (gasLimit) {
            this.arbitrationService.config.gasLimit = gasLimit;
        }
        if (maxFeePerGas) {
            this.arbitrationService.config.maxFeePerGas = maxFeePerGas;
        }
        if (maxPriorityFeePerGas) {
            this.arbitrationService.config.maxPriorityFeePerGas = maxPriorityFeePerGas;
        }
        if (makerApiEndpoint) {
            this.arbitrationService.config.makerApiEndpoint = makerApiEndpoint;
            try {
                const arbitrationConfig = await HTTPGet(`${makerApiEndpoint}/config/arbitration-client`);
                if (arbitrationConfig?.data?.subgraphEndpoint) {
                    this.arbitrationService.config.subgraphEndpoint = arbitrationConfig.data.subgraphEndpoint;
                }
            } catch (e) {
                logger.error(`request fail: ${makerApiEndpoint}/config/arbitration-client`, e);
            }
        }
        const config = JSON.parse(JSON.stringify(this.arbitrationService.config));
        delete config.privateKey;
        if (privateKey) {
            config.encryptPrivateKey = aesEncrypt(privateKey, config.secretKey ?? '');
        }
        await this.arbitrationService.configdb.push('/local', config);
        return { code: 0, message: 'success', result: config };
    }
}
