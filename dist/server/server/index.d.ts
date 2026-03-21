declare class IinPublicServer {
    private app;
    private server;
    private io;
    private gun;
    private gunService;
    private chatroomManager;
    private talkService;
    private userService;
    private reputationService;
    constructor();
    private setupGun;
    private setupMiddleware;
    private initializeServices;
    private normalizeIdentityText;
    private hashIdentityPayload;
    private buildIdentityPayloadFromTalk;
    private buildTalkIdentityKey;
    private canonicalIdentityKeyFromStoredCluster;
    private getMergedIncomingClusterForUser;
    private loadTalkDataFromGraphOrBody;
    private normalizeSubmittedAnswersForTalk;
    private buildAnswerTemplateEntries;
    private mapTemplateEntriesToTalk;
    private deriveIsAutoAnswerSet;
    private getUserStageName;
    private upsertIncomingTalkForUser;
    private getClusterSenders;
    private saveUserAnswerTemplateByContent;
    private createOrGetConversation;
    private fanoutResponseToSenders;
    private setupRoutes;
    private setupSocketHandlers;
    start(port?: number): void;
}
export default IinPublicServer;
//# sourceMappingURL=index.d.ts.map