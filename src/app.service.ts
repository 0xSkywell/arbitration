import { Injectable } from '@nestjs/common';
import { ethers, providers } from 'ethers';
import { aesEncrypt, HTTPGet } from './utils';
import logger from './utils/logger';
import { arbitrationConfig, configdb } from './utils/config';

@Injectable()
export class AppService {
    async setConfig(configParams: any) {
        const { privateKey, secretKey, rpc, debug, makerApiEndpoint, makerList, gasLimit, maxFeePerGas, maxPriorityFeePerGas } = configParams;
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
            arbitrationConfig.rpc = rpc;
        }
        if (privateKey) {
            if (arbitrationConfig.rpc) {
                try {
                    const provider = new providers.JsonRpcProvider({
                        url: arbitrationConfig.rpc,
                    });
                    const wallet = new ethers.Wallet(privateKey).connect(provider);
                    const address = await wallet.getAddress();
                    console.log(`Inject the ${address} wallet private key`);
                    arbitrationConfig.secretKey = secretKey ?? arbitrationConfig.secretKey;
                    arbitrationConfig.privateKey = privateKey;
                } catch (e) {
                    return { code: 1, message: 'PrivateKey error' };
                }
            }
        }
        if (makerList) {
            arbitrationConfig.makerList = makerList;
        }
        if (gasLimit) {
            arbitrationConfig.gasLimit = gasLimit;
        }
        if (maxFeePerGas) {
            arbitrationConfig.maxFeePerGas = maxFeePerGas;
        }
        if (maxPriorityFeePerGas) {
            arbitrationConfig.maxPriorityFeePerGas = maxPriorityFeePerGas;
        }
        if (debug) {
            arbitrationConfig.debug = debug;
        }
        if (makerApiEndpoint) {
            arbitrationConfig.makerApiEndpoint = makerApiEndpoint;
            try {
                const arbitrationClientConfig = await HTTPGet(`${makerApiEndpoint}/config/arbitration-client`);
                if (arbitrationClientConfig?.data?.subgraphEndpoint) {
                    arbitrationConfig.subgraphEndpoint = arbitrationClientConfig.data.subgraphEndpoint;
                } else {
                    logger.error(`request fail: ${makerApiEndpoint}/config/arbitration-client`, arbitrationClientConfig);
                }
            } catch (e) {
                logger.error(`request fail: ${makerApiEndpoint}/config/arbitration-client`, e);
            }
        }
        const config = JSON.parse(JSON.stringify(arbitrationConfig));
        delete config.privateKey;
        if (privateKey) {
            config.encryptPrivateKey = aesEncrypt(privateKey, config.secretKey ?? '');
        }
        await configdb.push('/local', config);
        return { code: 0, message: 'success', result: config };
    }
}
