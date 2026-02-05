# Android Frontend Technical Project Plan - IinPublic

## Project Overview
Native Android application for decentralized location-based chatbot communication system, featuring embedded Node-like runtime, comprehensive GPS integration, and optimized performance for mobile devices with offline-first architecture.

## Architecture Overview

### Native App Architecture

**Android Application Structure:**
```java
// Main Application Architecture
public class IinPublicApplication extends Application {
    private NodeRuntimeManager nodeRuntimeManager;
    private LocationManager locationManager;
    private GunPeerManager gunPeerManager;
    private NotificationManager notificationManager;
    
    @Override
    public void onCreate() {
        super.onCreate();
        initializeManagers();
        setupBackgroundServices();
    }
    
    private void initializeManagers() {
        nodeRuntimeManager = new NodeRuntimeManager(this);
        locationManager = new LocationManager(this);
        gunPeerManager = new GunPeerManager(nodeRuntimeManager);
        notificationManager = new NotificationManager(this);
    }
    
    private void setupBackgroundServices() {
        Intent serviceIntent = new Intent(this, GunPeerService.class);
        startForegroundService(serviceIntent);
    }
}
```

**Activity Hierarchy:**
```java
MainActivity (Single Activity Architecture)
├── ChatFragment
├── TalkEditorFragment  
├── BulkSendFragment
├── SurveyResultsFragment
├── ProfileFragment
├── SettingsFragment
└── LocationPermissionFragment

// Navigation Component Configuration
@NavigationGraph(R.navigation.main_nav_graph)
public class MainNavigationController {
    private NavController navController;
    private FragmentManager fragmentManager;
    
    public void setupNavigation(AppCompatActivity activity) {
        navController = Navigation.findNavController(activity, R.id.nav_host_fragment);
        setupDeepLinkHandlers();
        setupBottomNavigation();
    }
}
```

### Embedded Node-like Runtime Implementation

**JavaScript-to-Native Bridge:**
```java
public class NodeRuntimeManager {
    private V8Engine v8Engine;
    private Handler mainHandler;
    private ExecutorService jsExecutor;
    private Map<String, NativeBridge> bridges;
    
    public NodeRuntimeManager(Context context) {
        this.jsExecutor = Executors.newSingleThreadExecutor();
        this.mainHandler = new Handler(Looper.getMainLooper());
        this.bridges = new HashMap<>();
        
        initializeV8Engine(context);
        setupNativeBridges();
    }
    
    private void initializeV8Engine(Context context) {
        V8.createV8Runtime();
        v8Engine = V8Engine.createV8Engine();
        
        // Load core Node.js modules
        loadCoreModules();
        
        // Load Gun.js
        String gunJsSource = loadAssetFile(context, "gun.js");
        v8Engine.executeScript(gunJsSource);
        
        // Setup global objects
        setupGlobalObjects();
    }
    
    private void setupNativeBridges() {
        // File system bridge
        bridges.put("fs", new FileSystemBridge());
        
        // Network bridge
        bridges.put("http", new HttpBridge());
        
        // Crypto bridge
        bridges.put("crypto", new CryptoBridge());
        
        // Location bridge
        bridges.put("location", new LocationBridge());
        
        // Notification bridge
        bridges.put("notification", new NotificationBridge());
    }
    
    public void executeJavaScript(String script, JavaScriptCallback callback) {
        jsExecutor.submit(() -> {
            try {
                V8Object result = v8Engine.executeObjectScript(script);
                
                mainHandler.post(() -> {
                    callback.onSuccess(result);
                });
            } catch (Exception e) {
                mainHandler.post(() -> {
                    callback.onError(e);
                });
            }
        });
    }
}
```

**Native Bridge Implementations:**
```java
// File System Bridge
public class FileSystemBridge implements NativeBridge {
    private static final String INTERNAL_STORAGE_PATH = "/data/data/com.iinpublic/files/";
    
    @JavaScriptInterface
    public String readFile(String path) throws IOException {
        File file = new File(INTERNAL_STORAGE_PATH + path);
        return Files.readString(file.toPath());
    }
    
    @JavaScriptInterface
    public boolean writeFile(String path, String content) {
        try {
            File file = new File(INTERNAL_STORAGE_PATH + path);
            file.getParentFile().mkdirs();
            Files.writeString(file.toPath(), content);
            return true;
        } catch (IOException e) {
            Log.e("FileSystemBridge", "Write file error", e);
            return false;
        }
    }
    
    @JavaScriptInterface
    public boolean deleteFile(String path) {
        File file = new File(INTERNAL_STORAGE_PATH + path);
        return file.delete();
    }
    
    @JavaScriptInterface
    public String[] listDirectory(String path) {
        File directory = new File(INTERNAL_STORAGE_PATH + path);
        return directory.list();
    }
}

// Network Bridge
public class HttpBridge implements NativeBridge {
    private OkHttpClient httpClient;
    
    public HttpBridge() {
        httpClient = new OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .build();
    }
    
    @JavaScriptInterface
    public void httpRequest(String method, String url, String headers, String body, String callbackId) {
        Request.Builder requestBuilder = new Request.Builder().url(url);
        
        // Add headers
        if (headers != null) {
            JSONObject headerObj = new JSONObject(headers);
            headerObj.keys().forEachRemaining(key -> {
                requestBuilder.addHeader(key, headerObj.getString(key));
            });
        }
        
        // Add body for POST/PUT requests
        if ("POST".equals(method) || "PUT".equals(method)) {
            RequestBody requestBody = RequestBody.create(body, MediaType.get("application/json"));
            requestBuilder.method(method, requestBody);
        } else {
            requestBuilder.method(method, null);
        }
        
        httpClient.newCall(requestBuilder.build()).enqueue(new Callback() {
            @Override
            public void onResponse(Call call, Response response) {
                try {
                    String responseBody = response.body().string();
                    JSONObject result = new JSONObject();
                    result.put("status", response.code());
                    result.put("body", responseBody);
                    result.put("headers", getHeadersJson(response.headers()));
                    
                    invokeJavaScriptCallback(callbackId, result.toString());
                } catch (Exception e) {
                    invokeJavaScriptCallback(callbackId, "error:" + e.getMessage());
                }
            }
            
            @Override
            public void onFailure(Call call, IOException e) {
                invokeJavaScriptCallback(callbackId, "error:" + e.getMessage());
            }
        });
    }
}
```

### GPS Integration Technical Specifications

**Location Services Implementation:**
```java
public class LocationManager implements LocationListener {
    private android.location.LocationManager systemLocationManager;
    private FusedLocationProviderClient fusedLocationClient;
    private LocationRequest locationRequest;
    private LocationCallback locationCallback;
    private List<LocationUpdateListener> listeners;
    private LocationPrivacyManager privacyManager;
    
    public LocationManager(Context context) {
        systemLocationManager = (android.location.LocationManager) 
            context.getSystemService(Context.LOCATION_SERVICE);
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(context);
        privacyManager = new LocationPrivacyManager();
        listeners = new ArrayList<>();
        
        setupLocationRequest();
        setupLocationCallback();
    }
    
    private void setupLocationRequest() {
        locationRequest = LocationRequest.create()
            .setInterval(30000) // 30 seconds
            .setFastestInterval(10000) // 10 seconds
            .setPriority(LocationRequest.PRIORITY_HIGH_ACCURACY)
            .setMaxWaitTime(60000); // 1 minute
    }
    
    private void setupLocationCallback() {
        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult locationResult) {
                if (locationResult == null) return;
                
                for (Location location : locationResult.getLocations()) {
                    processLocationUpdate(location);
                }
            }
            
            @Override
            public void onLocationAvailability(LocationAvailability availability) {
                if (!availability.isLocationAvailable()) {
                    handleLocationUnavailable();
                }
            }
        };
    }
    
    @SuppressLint("MissingPermission")
    public void startLocationTracking() {
        if (checkLocationPermissions()) {
            fusedLocationClient.requestLocationUpdates(
                locationRequest, 
                locationCallback, 
                Looper.getMainLooper()
            );
        }
    }
    
    public void stopLocationTracking() {
        fusedLocationClient.removeLocationUpdates(locationCallback);
    }
    
    private void processLocationUpdate(Location location) {
        LocationData locationData = new LocationData(
            location.getLatitude(),
            location.getLongitude(),
            location.getAccuracy(),
            location.getTime(),
            location.getProvider()
        );
        
        // Apply privacy blurring
        LocationData blurredLocation = privacyManager.blurLocation(locationData);
        
        // Notify all listeners
        for (LocationUpdateListener listener : listeners) {
            listener.onLocationUpdate(locationData, blurredLocation);
        }
    }
    
    public boolean checkLocationPermissions() {
        return ContextCompat.checkSelfPermission(context, 
            Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(context,
            Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }
}

// Location Privacy Manager
public class LocationPrivacyManager {
    public enum BlurLevel {
        LOW(100),    // 100 meters
        MEDIUM(500), // 500 meters  
        HIGH(2000);  // 2 kilometers
        
        private final int radiusMeters;
        
        BlurLevel(int radiusMeters) {
            this.radiusMeters = radiusMeters;
        }
    }
    
    public LocationData blurLocation(LocationData trueLocation) {
        BlurLevel blurLevel = getUserBlurPreference();
        double radius = blurLevel.radiusMeters;
        
        // Generate random offset within blur radius
        Random random = new Random();
        double angle = random.nextDouble() * 2 * Math.PI;
        double distance = random.nextDouble() * radius;
        
        // Convert to lat/lng offset
        double deltaLat = (distance * Math.cos(angle)) / 111000; // ~111km per degree
        double deltaLng = (distance * Math.sin(angle)) / 
            (111000 * Math.cos(Math.toRadians(trueLocation.getLatitude())));
        
        return new LocationData(
            trueLocation.getLatitude() + deltaLat,
            trueLocation.getLongitude() + deltaLng,
            (float) radius, // Set accuracy to blur radius
            trueLocation.getTimestamp(),
            "privacy-blurred"
        );
    }
    
    private BlurLevel getUserBlurPreference() {
        // Load from SharedPreferences
        SharedPreferences prefs = PreferenceManager.getDefaultSharedPreferences(context);
        String level = prefs.getString("location_blur_level", "MEDIUM");
        return BlurLevel.valueOf(level);
    }
}
```

### Background Processing Implementation

**Foreground Service for Gun.js Peer:**
```java
public class GunPeerService extends Service {
    private static final int NOTIFICATION_ID = 1;
    private static final String CHANNEL_ID = "GunPeerServiceChannel";
    
    private NodeRuntimeManager nodeRuntimeManager;
    private PowerManager.WakeLock wakeLock;
    private Handler backgroundHandler;
    private HandlerThread backgroundThread;
    
    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        
        backgroundThread = new HandlerThread("GunPeerServiceThread");
        backgroundThread.start();
        backgroundHandler = new Handler(backgroundThread.getLooper());
        
        nodeRuntimeManager = ((IinPublicApplication) getApplication()).getNodeRuntimeManager();
        acquireWakeLock();
    }
    
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        
        switch (action) {
            case "START_PEER":
                startForeground(NOTIFICATION_ID, createNotification());
                startGunPeer();
                break;
            case "STOP_PEER":
                stopGunPeer();
                stopSelf();
                break;
            default:
                startForeground(NOTIFICATION_ID, createNotification());
                startGunPeer();
        }
        
        return START_STICKY; // Restart if killed by system
    }
    
    private void startGunPeer() {
        backgroundHandler.post(() -> {
            String gunInitScript = 
                "var Gun = require('gun'); " +
                "var gun = Gun(['wss://peer1.com', 'wss://peer2.com']); " +
                "gun.on('hi', function(peer) { " +
                "  console.log('Connected to peer:', peer); " +
                "}); " +
                "gun.on('bye', function(peer) { " +
                "  console.log('Disconnected from peer:', peer); " +
                "});";
                
            nodeRuntimeManager.executeJavaScript(gunInitScript, new JavaScriptCallback() {
                @Override
                public void onSuccess(Object result) {
                    Log.d("GunPeerService", "Gun peer started successfully");
                    updateNotification("Connected");
                }
                
                @Override
                public void onError(Exception error) {
                    Log.e("GunPeerService", "Failed to start Gun peer", error);
                    updateNotification("Connection Failed");
                }
            });
        });
    }
    
    private void acquireWakeLock() {
        PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK, 
            "IinPublic::GunPeerService"
        );
        wakeLock.acquire(10 * 60 * 1000L); // 10 minutes
    }
    
    private Notification createNotification() {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this, 0, notificationIntent, PendingIntent.FLAG_IMMUTABLE
        );
        
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("IinPublic")
            .setContentText("Connecting to network...")
            .setSmallIcon(R.drawable.ic_notification)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build();
    }
    
    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel serviceChannel = new NotificationChannel(
                CHANNEL_ID,
                "Gun Peer Service Channel",
                NotificationManager.IMPORTANCE_LOW
            );
            serviceChannel.setDescription("Maintains connection to decentralized network");
            
            NotificationManager manager = getSystemService(NotificationManager.class);
            manager.createNotificationChannel(serviceChannel);
        }
    }
}
```

**Background Sync Implementation:**
```java
public class MessageSyncService extends JobIntentService {
    private static final int JOB_ID = 2000;
    
    public static void enqueueWork(Context context, Intent work) {
        enqueueWork(context, MessageSyncService.class, JOB_ID, work);
    }
    
    @Override
    protected void onHandleWork(@NonNull Intent intent) {
        String action = intent.getAction();
        
        switch (action) {
            case "SYNC_MESSAGES":
                syncPendingMessages();
                break;
            case "SYNC_CONVERSATIONS":
                syncConversations();
                break;
            case "SYNC_USER_PROFILE":
                syncUserProfile();
                break;
        }
    }
    
    private void syncPendingMessages() {
        MessageDatabase db = MessageDatabase.getInstance(this);
        List<Message> pendingMessages = db.messageDao().getPendingMessages();
        
        for (Message message : pendingMessages) {
            try {
                boolean sent = sendMessageToGunNetwork(message);
                if (sent) {
                    message.status = MessageStatus.SENT;
                    db.messageDao().update(message);
                }
            } catch (Exception e) {
                Log.e("MessageSync", "Failed to sync message", e);
            }
        }
    }
    
    private boolean sendMessageToGunNetwork(Message message) {
        // Implementation would use NodeRuntimeManager to execute Gun.js operations
        CountDownLatch latch = new CountDownLatch(1);
        AtomicBoolean result = new AtomicBoolean(false);
        
        String sendScript = String.format(
            "gun.get('conversations').get('%s').get('messages').set({" +
            "  id: '%s'," +
            "  text: '%s'," +
            "  senderId: '%s'," +
            "  timestamp: %d" +
            "});",
            message.conversationId,
            message.id,
            message.text,
            message.senderId,
            message.timestamp
        );
        
        nodeRuntimeManager.executeJavaScript(sendScript, new JavaScriptCallback() {
            @Override
            public void onSuccess(Object r) {
                result.set(true);
                latch.countDown();
            }
            
            @Override
            public void onError(Exception error) {
                result.set(false);
                latch.countDown();
            }
        });
        
        try {
            latch.await(30, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        
        return result.get();
    }
}
```

## User Interface Implementation

### Native Android UI Components

**Main Activity with Navigation:**
```java
public class MainActivity extends AppCompatActivity {
    private ActivityMainBinding binding;
    private NavController navController;
    private BottomNavigationView bottomNavigation;
    private LocationPermissionManager permissionManager;
    
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        binding = ActivityMainBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());
        
        setupNavigation();
        setupLocationPermissions();
        setupNotificationHandler();
        checkAppPermissions();
    }
    
    private void setupNavigation() {
        navController = Navigation.findNavController(this, R.id.nav_host_fragment);
        bottomNavigation = binding.bottomNavigation;
        
        NavigationUI.setupWithNavController(bottomNavigation, navController);
        
        navController.addOnDestinationChangedListener((controller, destination, arguments) -> {
            // Hide bottom navigation for certain screens
            if (destination.getId() == R.id.talkEditorFragment ||
                destination.getId() == R.id.fullscreenChatFragment) {
                bottomNavigation.setVisibility(View.GONE);
            } else {
                bottomNavigation.setVisibility(View.VISIBLE);
            }
        });
    }
    
    private void setupLocationPermissions() {
        permissionManager = new LocationPermissionManager(this);
        
        if (!permissionManager.hasLocationPermissions()) {
            permissionManager.requestLocationPermissions();
        }
    }
    
    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, 
                                         @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        
        if (requestCode == LocationPermissionManager.LOCATION_PERMISSION_REQUEST_CODE) {
            if (permissionManager.hasLocationPermissions()) {
                startLocationServices();
            } else {
                showLocationPermissionDeniedDialog();
            }
        }
    }
    
    private void startLocationServices() {
        LocationManager locationManager = 
            ((IinPublicApplication) getApplication()).getLocationManager();
        locationManager.startLocationTracking();
    }
}
```

**Chat Fragment Implementation:**
```java
public class ChatFragment extends Fragment {
    private FragmentChatBinding binding;
    private ChatAdapter chatAdapter;
    private ConversationViewModel viewModel;
    private LinearLayoutManager layoutManager;
    private String conversationId;
    
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, ViewGroup container,
                           Bundle savedInstanceState) {
        binding = FragmentChatBinding.inflate(inflater, container, false);
        return binding.getRoot();
    }
    
    @Override
    public void onViewCreated(@NonNull View view, Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);
        
        conversationId = getArguments().getString("conversation_id");
        
        setupRecyclerView();
        setupViewModel();
        setupMessageInput();
        observeMessages();
    }
    
    private void setupRecyclerView() {
        chatAdapter = new ChatAdapter(this::onAnswerChipClicked, this::onMessageLongClick);
        layoutManager = new LinearLayoutManager(getContext());
        layoutManager.setStackFromEnd(true);
        
        binding.messagesRecyclerView.setLayoutManager(layoutManager);
        binding.messagesRecyclerView.setAdapter(chatAdapter);
        binding.messagesRecyclerView.setItemAnimator(new DefaultItemAnimator());
    }
    
    private void setupViewModel() {
        viewModel = new ViewModelProvider(this).get(ConversationViewModel.class);
        viewModel.setConversationId(conversationId);
    }
    
    private void setupMessageInput() {
        binding.messageInput.addTextChangedListener(new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            
            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {
                binding.sendButton.setEnabled(s.length() > 0);
                
                // Check for auto-linear capture pattern
                if (AutoLinearCaptureHelper.isQuestionAnswerPattern(s.toString())) {
                    showAutoLinearCaptureHint();
                }
            }
            
            @Override
            public void afterTextChanged(Editable s) {}
        });
        
        binding.sendButton.setOnClickListener(v -> sendMessage());
    }
    
    private void observeMessages() {
        viewModel.getMessages().observe(getViewLifecycleOwner(), messages -> {
            chatAdapter.submitList(new ArrayList<>(messages), () -> {
                if (messages.size() > 0) {
                    binding.messagesRecyclerView.scrollToPosition(messages.size() - 1);
                }
            });
        });
        
        viewModel.getTypingIndicator().observe(getViewLifecycleOwner(), isTyping -> {
            binding.typingIndicator.setVisibility(isTyping ? View.VISIBLE : View.GONE);
        });
    }
    
    private void sendMessage() {
        String text = binding.messageInput.getText().toString().trim();
        if (!text.isEmpty()) {
            Message message = new Message();
            message.id = UUID.randomUUID().toString();
            message.conversationId = conversationId;
            message.text = text;
            message.senderId = getCurrentUserId();
            message.timestamp = System.currentTimeMillis();
            message.status = MessageStatus.SENDING;
            
            viewModel.sendMessage(message);
            binding.messageInput.setText("");
        }
    }
    
    private void onAnswerChipClicked(String answer, String questionId) {
        // Handle answer selection for auto-captured talks
        viewModel.selectAnswer(questionId, answer);
    }
    
    private void onMessageLongClick(Message message) {
        // Show message options (copy, delete, report, etc.)
        MessageOptionsBottomSheet.show(getChildFragmentManager(), message);
    }
}
```

**Chat Adapter with ViewHolder Pattern:**
```java
public class ChatAdapter extends ListAdapter<Message, RecyclerView.ViewHolder> {
    private static final int VIEW_TYPE_MESSAGE_SENT = 1;
    private static final int VIEW_TYPE_MESSAGE_RECEIVED = 2;
    private static final int VIEW_TYPE_AUTO_CAPTURED = 3;
    
    private OnAnswerChipClickListener answerChipClickListener;
    private OnMessageLongClickListener messageLongClickListener;
    
    public interface OnAnswerChipClickListener {
        void onAnswerChipClick(String answer, String questionId);
    }
    
    public interface OnMessageLongClickListener {
        void onMessageLongClick(Message message);
    }
    
    public ChatAdapter(OnAnswerChipClickListener answerListener, 
                      OnMessageLongClickListener longClickListener) {
        super(new MessageDiffCallback());
        this.answerChipClickListener = answerListener;
        this.messageLongClickListener = longClickListener;
    }
    
    @Override
    public int getItemViewType(int position) {
        Message message = getItem(position);
        
        if (message.type == MessageType.AUTO_CAPTURED) {
            return VIEW_TYPE_AUTO_CAPTURED;
        } else if (message.isOwn()) {
            return VIEW_TYPE_MESSAGE_SENT;
        } else {
            return VIEW_TYPE_MESSAGE_RECEIVED;
        }
    }
    
    @Override
    public RecyclerView.ViewHolder onCreateViewHolder(ViewGroup parent, int viewType) {
        LayoutInflater inflater = LayoutInflater.from(parent.getContext());
        
        switch (viewType) {
            case VIEW_TYPE_MESSAGE_SENT:
                return new SentMessageViewHolder(
                    ItemMessageSentBinding.inflate(inflater, parent, false)
                );
            case VIEW_TYPE_MESSAGE_RECEIVED:
                return new ReceivedMessageViewHolder(
                    ItemMessageReceivedBinding.inflate(inflater, parent, false)
                );
            case VIEW_TYPE_AUTO_CAPTURED:
                return new AutoCapturedMessageViewHolder(
                    ItemMessageAutoCapturedBinding.inflate(inflater, parent, false)
                );
            default:
                throw new IllegalArgumentException("Unknown view type: " + viewType);
        }
    }
    
    @Override
    public void onBindViewHolder(RecyclerView.ViewHolder holder, int position) {
        Message message = getItem(position);
        
        if (holder instanceof SentMessageViewHolder) {
            ((SentMessageViewHolder) holder).bind(message);
        } else if (holder instanceof ReceivedMessageViewHolder) {
            ((ReceivedMessageViewHolder) holder).bind(message);
        } else if (holder instanceof AutoCapturedMessageViewHolder) {
            ((AutoCapturedMessageViewHolder) holder).bind(message, answerChipClickListener);
        }
    }
    
    // ViewHolder classes
    class AutoCapturedMessageViewHolder extends RecyclerView.ViewHolder {
        private ItemMessageAutoCapturedBinding binding;
        
        public AutoCapturedMessageViewHolder(ItemMessageAutoCapturedBinding binding) {
            super(binding.getRoot());
            this.binding = binding;
        }
        
        public void bind(Message message, OnAnswerChipClickListener clickListener) {
            binding.questionText.setText(message.questionText);
            
            // Setup answer chips
            binding.answerChipsContainer.removeAllViews();
            
            for (String answer : message.answerOptions) {
                Chip answerChip = new Chip(itemView.getContext());
                answerChip.setText(answer);
                answerChip.setCheckable(false);
                answerChip.setOnClickListener(v -> {
                    clickListener.onAnswerChipClick(answer, message.questionId);
                });
                
                binding.answerChipsContainer.addView(answerChip);
            }
            
            // Setup user info
            binding.userAvatar.setImageResource(message.sender.avatarResId);
            binding.userName.setText(message.sender.stageName);
            
            if (message.sender.isTraveller) {
                binding.travellerBadge.setVisibility(View.VISIBLE);
            } else {
                binding.travellerBadge.setVisibility(View.GONE);
            }
            
            binding.timestamp.setText(formatTimestamp(message.timestamp));
        }
    }
}
```

### Android-Specific Features

**GPS Integration with Location Services:**
```java
public class ChatroomLocationManager {
    private LocationManager locationManager;
    private ChatroomManager chatroomManager;
    private GeofencingClient geofencingClient;
    
    public ChatroomLocationManager(Context context) {
        locationManager = ((IinPublicApplication) context.getApplicationContext())
            .getLocationManager();
        chatroomManager = new ChatroomManager();
        geofencingClient = LocationServices.getGeofencingClient(context);
        
        setupLocationTracking();
    }
    
    private void setupLocationTracking() {
        locationManager.addLocationUpdateListener(new LocationUpdateListener() {
            @Override
            public void onLocationUpdate(LocationData trueLocation, LocationData blurredLocation) {
                updateCurrentChatroom(blurredLocation);
                checkGeofenceTransitions(trueLocation);
            }
        });
    }
    
    private void updateCurrentChatroom(LocationData location) {
        String newChatroomId = chatroomManager.getChatroomForLocation(
            location.getLatitude(), 
            location.getLongitude()
        );
        
        String currentChatroomId = getCurrentChatroomId();
        
        if (!newChatroomId.equals(currentChatroomId)) {
            // Leave current chatroom
            if (currentChatroomId != null) {
                chatroomManager.leaveChatroom(currentChatroomId);
            }
            
            // Join new chatroom
            chatroomManager.joinChatroom(newChatroomId);
            setCurrentChatroomId(newChatroomId);
            
            // Notify user of chatroom change
            showChatroomChangeNotification(newChatroomId);
        }
    }
    
    private void setupBusinessLocationGeofences() {
        List<BusinessLocation> businessLocations = getBusinessLocations();
        
        List<Geofence> geofences = businessLocations.stream()
            .map(business -> new Geofence.Builder()
                .setRequestId(business.getId())
                .setCircularRegion(business.getLatitude(), business.getLongitude(), business.getRadius())
                .setExpirationDuration(Geofence.NEVER_EXPIRE)
                .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER | Geofence.GEOFENCE_TRANSITION_EXIT)
                .build())
            .collect(Collectors.toList());
        
        GeofencingRequest request = new GeofencingRequest.Builder()
            .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_ENTER)
            .addGeofences(geofences)
            .build();
        
        Intent intent = new Intent(context, GeofenceTransitionService.class);
        PendingIntent pendingIntent = PendingIntent.getService(
            context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        
        if (ActivityCompat.checkSelfPermission(context, 
            Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
            geofencingClient.addGeofences(request, pendingIntent);
        }
    }
}
```

**Push Notification Integration:**
```java
public class IinPublicFirebaseMessagingService extends FirebaseMessagingService {
    private static final String TAG = "FCMService";
    
    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        Log.d(TAG, "From: " + remoteMessage.getFrom());
        
        // Handle different message types
        String messageType = remoteMessage.getData().get("type");
        
        switch (messageType) {
            case "new_message":
                handleNewMessage(remoteMessage);
                break;
            case "bulk_send":
                handleBulkSendNotification(remoteMessage);
                break;
            case "friend_request":
                handleFriendRequest(remoteMessage);
                break;
            case "system_notification":
                handleSystemNotification(remoteMessage);
                break;
        }
    }
    
    private void handleNewMessage(RemoteMessage remoteMessage) {
        String conversationId = remoteMessage.getData().get("conversation_id");
        String senderId = remoteMessage.getData().get("sender_id");
        String messageText = remoteMessage.getData().get("message");
        String senderName = remoteMessage.getData().get("sender_name");
        
        // Store message in local database
        MessageDatabase.getInstance(this).messageDao().insert(
            Message.fromNotification(conversationId, senderId, messageText)
        );
        
        // Show notification only if app is not in foreground
        if (!isAppInForeground()) {
            showMessageNotification(conversationId, senderName, messageText);
        }
    }
    
    private void showMessageNotification(String conversationId, String senderName, String messageText) {
        Intent intent = new Intent(this, MainActivity.class);
        intent.putExtra("conversation_id", conversationId);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, "messages")
            .setSmallIcon(R.drawable.ic_message)
            .setContentTitle(senderName)
            .setContentText(messageText)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(messageText))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE);
        
        // Add reply action
        RemoteInput remoteInput = new RemoteInput.Builder("reply_text")
            .setLabel("Reply")
            .build();
        
        Intent replyIntent = new Intent(this, MessageReplyReceiver.class);
        replyIntent.putExtra("conversation_id", conversationId);
        
        PendingIntent replyPendingIntent = PendingIntent.getBroadcast(
            this, 0, replyIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        
        NotificationCompat.Action replyAction = new NotificationCompat.Action.Builder(
            R.drawable.ic_reply, "Reply", replyPendingIntent
        ).addRemoteInput(remoteInput).build();
        
        builder.addAction(replyAction);
        
        NotificationManagerCompat.from(this).notify(conversationId.hashCode(), builder.build());
    }
    
    @Override
    public void onNewToken(String token) {
        Log.d(TAG, "Refreshed token: " + token);
        
        // Send token to server
        sendRegistrationToServer(token);
    }
    
    private void sendRegistrationToServer(String token) {
        // Implementation to register FCM token with Gun.js network
        String userId = getCurrentUserId();
        if (userId != null) {
            NodeRuntimeManager nodeManager = 
                ((IinPublicApplication) getApplication()).getNodeRuntimeManager();
            
            String script = String.format(
                "gun.user().get('fcm_token').put('%s');",
                token
            );
            
            nodeManager.executeJavaScript(script, new JavaScriptCallback() {
                @Override
                public void onSuccess(Object result) {
                    Log.d(TAG, "FCM token registered successfully");
                }
                
                @Override
                public void onError(Exception error) {
                    Log.e(TAG, "Failed to register FCM token", error);
                }
            });
        }
    }
}
```

## Platform-Specific Performance Optimization

### Resource Usage Optimization

**Memory Management:**
```java
public class MemoryManager {
    private static final long MAX_MEMORY_USAGE = Runtime.getRuntime().maxMemory() * 3 / 4; // 75% of max
    private LruCache<String, Bitmap> imageCache;
    private Map<String, WeakReference<Object>> objectCache;
    
    public MemoryManager() {
        int maxMemory = (int) (Runtime.getRuntime().maxMemory() / 1024);
        int cacheSize = maxMemory / 8; // Use 1/8th of available memory for image cache
        
        imageCache = new LruCache<String, Bitmap>(cacheSize) {
            @Override
            protected int sizeOf(String key, Bitmap bitmap) {
                return bitmap.getByteCount() / 1024;
            }
        };
        
        objectCache = new ConcurrentHashMap<>();
    }
    
    public void monitorMemoryUsage() {
        Handler memoryHandler = new Handler();
        Runnable memoryCheckRunnable = new Runnable() {
            @Override
            public void run() {
                Runtime runtime = Runtime.getRuntime();
                long usedMemory = runtime.totalMemory() - runtime.freeMemory();
                
                if (usedMemory > MAX_MEMORY_USAGE) {
                    performMemoryCleanup();
                }
                
                memoryHandler.postDelayed(this, 30000); // Check every 30 seconds
            }
        };
        
        memoryHandler.post(memoryCheckRunnable);
    }
    
    private void performMemoryCleanup() {
        // Clear image cache
        imageCache.evictAll();
        
        // Clear weak references that are null
        objectCache.entrySet().removeIf(entry -> entry.getValue().get() == null);
        
        // Trigger garbage collection
        System.gc();
        
        Log.d("MemoryManager", "Memory cleanup performed");
    }
    
    public Bitmap getImageFromCache(String url) {
        return imageCache.get(url);
    }
    
    public void putImageInCache(String url, Bitmap bitmap) {
        imageCache.put(url, bitmap);
    }
}
```

**Battery Optimization:**
```java
public class BatteryOptimizer {
    private Context context;
    private PowerManager powerManager;
    private ConnectivityManager connectivityManager;
    private Handler batteryHandler;
    
    public BatteryOptimizer(Context context) {
        this.context = context;
        this.powerManager = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        this.connectivityManager = (ConnectivityManager) 
            context.getSystemService(Context.CONNECTIVITY_SERVICE);
        this.batteryHandler = new Handler();
        
        setupBatteryMonitoring();
    }
    
    private void setupBatteryMonitoring() {
        IntentFilter filter = new IntentFilter();
        filter.addAction(Intent.ACTION_BATTERY_CHANGED);
        filter.addAction(PowerManager.ACTION_POWER_SAVE_MODE_CHANGED);
        
        context.registerReceiver(new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String action = intent.getAction();
                
                if (Intent.ACTION_BATTERY_CHANGED.equals(action)) {
                    int level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                    int scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
                    float batteryLevel = level * 100 / (float) scale;
                    
                    adjustPerformanceBasedOnBattery(batteryLevel);
                } else if (PowerManager.ACTION_POWER_SAVE_MODE_CHANGED.equals(action)) {
                    boolean powerSaveMode = powerManager.isPowerSaveMode();
                    adjustForPowerSaveMode(powerSaveMode);
                }
            }
        }, filter);
    }
    
    private void adjustPerformanceBasedOnBattery(float batteryLevel) {
        if (batteryLevel < 20) {
            // Aggressive battery saving
            enableAggressiveBatterySaving();
        } else if (batteryLevel < 50) {
            // Moderate battery saving
            enableModerateBatterySaving();
        } else {
            // Normal operation
            enableNormalOperation();
        }
    }
    
    private void enableAggressiveBatterySaving() {
        // Reduce location update frequency
        LocationManager locationManager = 
            ((IinPublicApplication) context.getApplicationContext()).getLocationManager();
        locationManager.setUpdateInterval(300000); // 5 minutes
        
        // Reduce Gun.js sync frequency
        // Pause non-essential background tasks
        // Lower screen brightness suggestions
        
        Log.d("BatteryOptimizer", "Aggressive battery saving enabled");
    }
    
    private void enableModerateBatterySaving() {
        // Reduce location update frequency slightly
        LocationManager locationManager = 
            ((IinPublicApplication) context.getApplicationContext()).getLocationManager();
        locationManager.setUpdateInterval(120000); // 2 minutes
        
        Log.d("BatteryOptimizer", "Moderate battery saving enabled");
    }
    
    private void enableNormalOperation() {
        // Normal location update frequency
        LocationManager locationManager = 
            ((IinPublicApplication) context.getApplicationContext()).getLocationManager();
        locationManager.setUpdateInterval(30000); // 30 seconds
        
        Log.d("BatteryOptimizer", "Normal operation enabled");
    }
}
```

### Network Optimization

**Adaptive Network Usage:**
```java
public class NetworkOptimizer {
    private ConnectivityManager connectivityManager;
    private NetworkCallback networkCallback;
    private boolean isOnWiFi = false;
    private boolean isOnMetered = true;
    
    public NetworkOptimizer(Context context) {
        connectivityManager = (ConnectivityManager) 
            context.getSystemService(Context.CONNECTIVITY_SERVICE);
        setupNetworkMonitoring();
    }
    
    private void setupNetworkMonitoring() {
        NetworkRequest.Builder builder = new NetworkRequest.Builder();
        
        networkCallback = new NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                updateNetworkStatus(network);
            }
            
            @Override
            public void onCapabilitiesChanged(Network network, NetworkCapabilities capabilities) {
                isOnWiFi = capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI);
                isOnMetered = !capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED);
                
                adjustNetworkUsage();
            }
            
            @Override
            public void onLost(Network network) {
                handleNetworkLoss();
            }
        };
        
        connectivityManager.registerNetworkCallback(builder.build(), networkCallback);
    }
    
    private void adjustNetworkUsage() {
        NodeRuntimeManager nodeManager = 
            ((IinPublicApplication) context.getApplicationContext()).getNodeRuntimeManager();
        
        if (isOnWiFi && !isOnMetered) {
            // Full sync mode
            enableFullSyncMode(nodeManager);
        } else if (!isOnMetered) {
            // Moderate sync mode
            enableModerateSyncMode(nodeManager);
        } else {
            // Conservative sync mode for metered connections
            enableConservativeSyncMode(nodeManager);
        }
    }
    
    private void enableConservativeSyncMode(NodeRuntimeManager nodeManager) {
        String script = 
            "gun.opt({" +
            "  batch: 1000," +  // Batch more messages
            "  wait: 5000," +   // Wait longer between syncs
            "  chunk: 1024" +   // Smaller chunks
            "});";
            
        nodeManager.executeJavaScript(script, null);
        
        Log.d("NetworkOptimizer", "Conservative sync mode enabled");
    }
    
    private void enableFullSyncMode(NodeRuntimeManager nodeManager) {
        String script = 
            "gun.opt({" +
            "  batch: 100," +   // Less batching
            "  wait: 1000," +   // Faster sync
            "  chunk: 4096" +   // Larger chunks
            "});";
            
        nodeManager.executeJavaScript(script, null);
        
        Log.d("NetworkOptimizer", "Full sync mode enabled");
    }
}
```

## Data Storage and Offline Support

### Room Database Integration

```java
@Database(
    entities = {Message.class, Conversation.class, User.class, Talk.class}, 
    version = 1
)
@TypeConverters({Converters.class})
public abstract class AppDatabase extends RoomDatabase {
    private static volatile AppDatabase INSTANCE;
    
    public abstract MessageDao messageDao();
    public abstract ConversationDao conversationDao();
    public abstract UserDao userDao();
    public abstract TalkDao talkDao();
    
    public static AppDatabase getDatabase(final Context context) {
        if (INSTANCE == null) {
            synchronized (AppDatabase.class) {
                if (INSTANCE == null) {
                    INSTANCE = Room.databaseBuilder(
                        context.getApplicationContext(),
                        AppDatabase.class,
                        "iinpublic_database"
                    )
                    .addMigrations(MIGRATION_1_2)
                    .build();
                }
            }
        }
        return INSTANCE;
    }
    
    static final Migration MIGRATION_1_2 = new Migration(1, 2) {
        @Override
        public void migrate(SupportSQLiteDatabase database) {
            database.execSQL("ALTER TABLE messages ADD COLUMN reply_to_id TEXT");
            database.execSQL("CREATE INDEX index_messages_reply_to_id ON messages(reply_to_id)");
        }
    };
}
```

This comprehensive Android frontend project plan provides detailed technical specifications for implementing the native Android application for the IinPublic decentralized location-based chatbot communication system, including embedded Node.js runtime, GPS integration, performance optimization, and robust offline support.
