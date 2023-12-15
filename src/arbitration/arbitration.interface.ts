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
    minChallengeDepositAmount: string;
}

export interface VerifyChallengeSourceParams {
    hash: string;
    sourceMaker: string;
    spvAddress: string;
    sourceChain: string;
    proof: string;
    rawDatas: string;
    rlpRuleBytes: string;
}

export interface VerifyChallengeDestParams {
    sourceMaker: string;
    sourceTime: string;
    targetNonce: string;
    targetChain: string;
    targetAddress: string;
    targetToken: string;
    targetAmount: string;
    responseMakersHash: string;
    responseTime: string;
    challenger: string;
    spvAddress: string;
    sourceChain: string;
    sourceId: string;
    proof: string;
    rawDatas: string;
}
