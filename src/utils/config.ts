import { Config, JsonDB } from 'node-json-db';
import { aesDecrypt } from './index';

export let arbitrationConfig: {
    privateKey?: string, secretKey?: string, rpc?: string, makerApiEndpoint?: string, subgraphEndpoint?: string, makerList?: string[], gasLimit?: string, maxFeePerGas?: string, maxPriorityFeePerGas?: string
} = {};

export const configdb = new JsonDB(new Config('runtime/config', true, false, '/'));

async function initConfig() {
    try {
        const localConfig = await configdb.getData('/local') || {};
        arbitrationConfig = localConfig;
        if (localConfig.encryptPrivateKey) {
            arbitrationConfig.privateKey = aesDecrypt(localConfig.encryptPrivateKey, localConfig.secretKey || '');
        }
    } catch (e) {
    }
}

initConfig();
