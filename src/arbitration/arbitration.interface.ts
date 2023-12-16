export interface ArbitrationTransaction {
    ebcAddress: string;
    ruleId: string;
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
    ebcAddress: string;
    ruleId: string;
    sourceMaker: string;
    sourceTime: string;
    sourceAddress: string;
    sourceNonce: string;
    targetNonce: string;
    targetChain: string;
    targetToken: string;
    sourceAmount: string;
    challenger: string;
    spvAddress: string;
    sourceChain: string;
    sourceId: string;
    proof: string;
}
