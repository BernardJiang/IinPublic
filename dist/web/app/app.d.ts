import { User, GPSCoordinate } from '../../shared/types';
export declare class IinPublicApp {
    private gunService;
    private userService;
    private chatroomService;
    private talkService;
    private uiManager;
    private currentUser?;
    private currentLocation?;
    constructor();
    initialize(location: GPSCoordinate): Promise<void>;
    private initializeUser;
    private createNewUser;
    private initializeChatrooms;
    private setupEventHandlers;
    getCurrentUser(): User | undefined;
    getCurrentLocation(): GPSCoordinate | undefined;
    refreshUserData(): Promise<void>;
    logout(): Promise<void>;
}
//# sourceMappingURL=app.d.ts.map