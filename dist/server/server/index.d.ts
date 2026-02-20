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
    private setupRoutes;
    private setupSocketHandlers;
    start(port?: number): void;
}
export default IinPublicServer;
//# sourceMappingURL=index.d.ts.map