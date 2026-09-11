export type ChatroomInfoDeps = {
  setCurrentChatroom: (id: string) => void;
  syncStatusBroadcastButtonVisibility: () => void;
};

export function updateChatroomInfo(info: { id: string; name: string } | any, deps: ChatroomInfoDeps): void {
  // Update current chatroom tracking
  if (info.id) {
    deps.setCurrentChatroom(info.id);
  }
  deps.syncStatusBroadcastButtonVisibility();

  const chatroomInfo = document.getElementById('chatroom-info');
  if (chatroomInfo && info.id && info.name) {
    chatroomInfo.innerHTML = `
      <div class="chatroom-title">${info.name}</div>
      <div class="chatroom-status">Connected</div>
    `;
  } else {
    console.log('Chatroom updated:', info);
  }
}
