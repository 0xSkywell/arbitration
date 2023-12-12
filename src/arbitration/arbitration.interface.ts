export interface ArbitrationTransaction {
    sourceMaker: string;
    sourceTxTime: number;
    sourceChainId: number;
    sourceTxBlockNum: number;
    sourceTxIndex: number;
    sourceTxHash: string;
    ruleKey: string;
    freezeToken: string;
    freezeAmount1: string;
    parentNodeNumOfTargetNode: number;
    spvAddress: string;
}

export interface ArbitrationDB {
    makerAddress?: string;
    challenger?: string;
    spvAddress?: string;
    isSource?: number;
    sourceChain?: number;
    targetChain?: number;
    targetTxHash?: string;
    sourceChainId?: number;
    sourceTxHash?: string;
    proof?: string;
    mdcAddress: string;
    status: number;
    targetNonce?: string; // TODO
    targetFrom?: string; // TODO
    targetToken?: string; // TODO
    targetAmount?: string; // TODO
    responseMakersHash?: string; // TODO
    responseTime?: string; // TODO
    rawDatas?: string; // TODO
    rlpRuleBytes?: string; // TODO
}
