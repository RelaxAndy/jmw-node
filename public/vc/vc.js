// firebase config - replace with your own
const firebaseConfig = {
  apiKey: "AIzaSyC7jhfwo8pX2M0ux0Vtt0di2As9mUfH-7s",
  authDomain: "voicechat-global.firebaseapp.com",
  projectId: "voicechat-global",
  storageBucket: "voicechat-global.firebasestorage.app",
  messagingSenderId: "810575934201",
  appId: "1:810575934201:web:7bfb46b12243f6d9d22828",
  measurementId: "G-GSJWGXFEET"
};

// initialize firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// app state
const state = {
    username: '',
    userId: null,
    currentRoom: null,
    currentRoomId: null,
    isMuted: false,
    isDeafened: false,
    selectedPrivateRoom: null,
    listeners: []
};

// start the app
document.addEventListener('DOMContentLoaded', () => {
    init();
});

function init() {
    showUsernameModal();
    setupListeners();
    initGeneralRooms();
}

function setupListeners() {
    // username modal
    document.getElementById('set-username').addEventListener('click', setUsername);
    document.getElementById('username-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') setUsername();
    });
    
    // modal controls
    document.getElementById('create-room-btn').addEventListener('click', () => {
        document.getElementById('create-room-modal').classList.remove('hidden');
    });
    
    document.getElementById('close-create').addEventListener('click', () => {
        document.getElementById('create-room-modal').classList.add('hidden');
    });
    
    document.getElementById('close-join').addEventListener('click', () => {
        document.getElementById('join-private-modal').classList.add('hidden');
    });
    
    document.getElementById('close-admin').addEventListener('click', () => {
        document.getElementById('admin-modal').classList.add('hidden');
    });
    
    document.getElementById('room-type').addEventListener('change', (e) => {
        const passwordGroup = document.getElementById('password-group');
        passwordGroup.style.display = e.target.value === 'private' ? 'block' : 'none';
    });
    
    // action buttons
    document.getElementById('create-room').addEventListener('click', createRoom);
    document.getElementById('join-private').addEventListener('click', joinPrivateRoom);
    document.getElementById('leave-room').addEventListener('click', leaveRoom);
    document.getElementById('create-stage').addEventListener('click', createStage);
    
    // user controls
    document.getElementById('mute-btn').addEventListener('click', toggleMute);
    document.getElementById('deafen-btn').addEventListener('click', toggleDeafen);
    document.getElementById('settings-btn').addEventListener('click', () => {
        document.getElementById('admin-modal').classList.remove('hidden');
    });
    
    // general rooms
    document.querySelectorAll('.room-item[data-type="general"]').forEach(item => {
        item.addEventListener('click', () => {
            const roomId = item.dataset.room;
            joinGeneralRoom(roomId);
        });
    });
    
    // soundboard
    document.querySelectorAll('.sound-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const sound = btn.dataset.sound;
            playSound(sound);
        });
    });
}

// username stuff
function showUsernameModal() {
    document.getElementById('username-modal').classList.remove('hidden');
}

function setUsername() {
    const input = document.getElementById('username-input');
    const username = input.value.trim();
    
    if (username.length === 0) {
        alert('Please enter a username');
        return;
    }
    
    if (username.length > 14) {
        alert('Username must be 14 characters or less');
        return;
    }
    
    state.username = username;
    state.userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    document.getElementById('current-username').textContent = username;
    document.getElementById('user-initial').textContent = username.charAt(0).toUpperCase();
    document.getElementById('username-modal').classList.add('hidden');
    
    // set user online status
    setUserOnline();
    
    // start listening to rooms
    listenToCustomRooms();
    listenToStages();
}

function setUserOnline() {
    const userRef = db.ref('users/' + state.userId);
    
    userRef.set({
        username: state.username,
        online: true,
        lastSeen: firebase.database.ServerValue.TIMESTAMP
    });
    
    // cleanup when user disconnects
    userRef.onDisconnect().remove();
}

// general rooms setup
function initGeneralRooms() {
    const rooms = ['general-1', 'general-2', 'general-3'];
    
    rooms.forEach(roomId => {
        const roomRef = db.ref('rooms/' + roomId);
        
        // create room if it doesn't exist
        roomRef.once('value', (snapshot) => {
            if (!snapshot.exists()) {
                roomRef.set({
                    name: roomId.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase()),
                    type: 'general',
                    users: {}
                });
            }
        });
        
        // listen to user count changes
        roomRef.child('users').on('value', (snapshot) => {
            const users = snapshot.val() || {};
            const count = Object.keys(users).length;
            
            const roomItem = document.querySelector(`.room-item[data-room="${roomId}"]`);
            if (roomItem) {
                const countSpan = roomItem.querySelector('.user-count');
                if (countSpan) countSpan.textContent = count;
            }
        });
    });
}

function joinGeneralRoom(roomId) {
    if (state.currentRoomId) {
        leaveRoom();
    }
    
    const roomRef = db.ref('rooms/' + roomId);
    
    // add user to room
    roomRef.child('users/' + state.userId).set({
        username: state.username,
        muted: state.isMuted,
        deafened: state.isDeafened,
        speaking: false,
        joinedAt: firebase.database.ServerValue.TIMESTAMP
    });
    
    // cleanup on disconnect
    roomRef.child('users/' + state.userId).onDisconnect().remove();
    
    state.currentRoomId = roomId;
    
    // get room info
    roomRef.once('value', (snapshot) => {
        const roomData = snapshot.val();
        state.currentRoom = { id: roomId, ...roomData };
        
        updateRoomUI();
        showVoiceRoom();
        listenToRoomUsers(roomId);
    });
}

// custom rooms
function listenToCustomRooms() {
    const roomsRef = db.ref('customRooms');
    
    roomsRef.on('value', (snapshot) => {
        const rooms = snapshot.val() || {};
        renderCustomRooms(rooms);
    });
}

function renderCustomRooms(rooms) {
    const container = document.getElementById('custom-rooms');
    container.innerHTML = '';
    
    const roomsArray = Object.entries(rooms);
    
    if (roomsArray.length === 0) {
        container.innerHTML = '<div class="no-stages">No custom rooms</div>';
        return;
    }
    
    roomsArray.forEach(([roomId, room]) => {
        const roomItem = document.createElement('div');
        roomItem.className = 'room-item' + (room.type === 'private' ? ' private' : '');
        
        if (state.currentRoomId === roomId) {
            roomItem.classList.add('active');
        }
        
        const userCount = room.users ? Object.keys(room.users).length : 0;
        
        roomItem.innerHTML = `
            <i class='bx bx-hash'></i>
            <span>${room.name}</span>
            <span class="user-count">${userCount}/10</span>
        `;
        
        roomItem.addEventListener('click', () => {
            if (room.type === 'private' && (!room.users || !room.users[state.userId])) {
                state.selectedPrivateRoom = { id: roomId, ...room };
                document.getElementById('private-room-label').textContent = `Enter password for ${room.name}`;
                document.getElementById('join-private-modal').classList.remove('hidden');
            } else {
                joinCustomRoom(roomId);
            }
        });
        
        container.appendChild(roomItem);
    });
}

function createRoom() {
    const roomName = document.getElementById('room-name').value.trim();
    const roomType = document.getElementById('room-type').value;
    const password = document.getElementById('room-password').value;
    
    if (!roomName) {
        alert('Please enter a room name');
        return;
    }
    
    if (roomType === 'private' && !password) {
        alert('Please enter a password for the private room');
        return;
    }
    
    const roomId = 'custom_' + Date.now();
    const roomRef = db.ref('customRooms/' + roomId);
    
    const roomData = {
        name: roomName,
        type: roomType,
        createdBy: state.userId,
        createdAt: firebase.database.ServerValue.TIMESTAMP,
        users: {}
    };
    
    if (roomType === 'private') {
        roomData.password = password;
    }
    
    roomRef.set(roomData).then(() => {
        document.getElementById('create-room-modal').classList.add('hidden');
        
        // clear the form
        document.getElementById('room-name').value = '';
        document.getElementById('room-password').value = '';
        document.getElementById('room-type').value = 'public';
        document.getElementById('password-group').style.display = 'none';
        
        // join the new room
        joinCustomRoom(roomId);
    });
}

function joinPrivateRoom() {
    const password = document.getElementById('private-password').value;
    const room = state.selectedPrivateRoom;
    
    if (!room) return;
    
    if (password !== room.password) {
        alert('Incorrect password');
        return;
    }
    
    const userCount = room.users ? Object.keys(room.users).length : 0;
    if (userCount >= 10) {
        alert('Room is full (max 10 users)');
        return;
    }
    
    document.getElementById('join-private-modal').classList.add('hidden');
    document.getElementById('private-password').value = '';
    
    joinCustomRoom(room.id);
}

function joinCustomRoom(roomId) {
    if (state.currentRoomId) {
        leaveRoom();
    }
    
    const roomRef = db.ref('customRooms/' + roomId);
    
    // check if room exists and has space
    roomRef.once('value', (snapshot) => {
        if (!snapshot.exists()) {
            alert('Room no longer exists');
            return;
        }
        
        const room = snapshot.val();
        const userCount = room.users ? Object.keys(room.users).length : 0;
        
        if (userCount >= 10) {
            alert('Room is full (max 10 users)');
            return;
        }
        
        // add user to room
        roomRef.child('users/' + state.userId).set({
            username: state.username,
            muted: state.isMuted,
            deafened: state.isDeafened,
            speaking: false,
            joinedAt: firebase.database.ServerValue.TIMESTAMP
        });
        
        // cleanup on disconnect
        roomRef.child('users/' + state.userId).onDisconnect().remove();
        
        // delete empty rooms
        roomRef.child('users').onDisconnect().once('value', (snap) => {
            if (!snap.exists() || Object.keys(snap.val()).length === 0) {
                roomRef.remove();
            }
        });
        
        state.currentRoomId = roomId;
        state.currentRoom = { id: roomId, ...room };
        
        updateRoomUI();
        showVoiceRoom();
        listenToRoomUsers(roomId, 'customRooms');
    });
}

// stages stuff
function listenToStages() {
    const stagesRef = db.ref('stages');
    
    stagesRef.on('value', (snapshot) => {
        const stages = snapshot.val() || {};
        renderStages(stages);
    });
}

function renderStages(stages) {
    const container = document.getElementById('stages-list');
    container.innerHTML = '';
    
    const stagesArray = Object.entries(stages);
    
    if (stagesArray.length === 0) {
        container.innerHTML = '<div class="no-stages">No active stages</div>';
        return;
    }
    
    stagesArray.forEach(([stageId, stage]) => {
        const stageItem = document.createElement('div');
        stageItem.className = 'room-item';
        
        if (state.currentRoomId === stageId) {
            stageItem.classList.add('active');
        }
        
        const speakerCount = stage.speakers ? Object.keys(stage.speakers).length : 0;
        const audienceCount = stage.audience ? Object.keys(stage.audience).length : 0;
        
        stageItem.innerHTML = `
            <i class='bx bx-broadcast'></i>
            <span>${stage.name}</span>
            <span class="user-count">${speakerCount + audienceCount}</span>
        `;
        
        stageItem.addEventListener('click', () => joinStage(stageId));
        container.appendChild(stageItem);
    });
}

function createStage() {
    const stageName = document.getElementById('stage-name').value.trim();
    
    if (!stageName) {
        alert('Please enter a stage name');
        return;
    }
    
    const stageId = 'stage_' + Date.now();
    const stageRef = db.ref('stages/' + stageId);
    
    stageRef.set({
        name: stageName,
        createdBy: state.userId,
        createdAt: firebase.database.ServerValue.TIMESTAMP,
        speakers: {},
        audience: {}
    }).then(() => {
        document.getElementById('admin-modal').classList.add('hidden');
        document.getElementById('stage-name').value = '';
        
        showNotification('Stage created successfully!');
    });
}

function joinStage(stageId) {
    if (state.currentRoomId) {
        leaveRoom();
    }
    
    const stageRef = db.ref('stages/' + stageId);
    
    // add to audience
    stageRef.child('audience/' + state.userId).set({
        username: state.username,
        joinedAt: firebase.database.ServerValue.TIMESTAMP
    });
    
    stageRef.child('audience/' + state.userId).onDisconnect().remove();
    
    state.currentRoomId = stageId;
    
    stageRef.once('value', (snapshot) => {
        const stageData = snapshot.val();
        state.currentRoom = { id: stageId, type: 'stage', ...stageData };
        
        document.getElementById('current-room-name').textContent = stageData.name;
        document.getElementById('leave-room').classList.remove('hidden');
        document.getElementById('default-view').classList.add('hidden');
        document.getElementById('voice-room').classList.add('hidden');
        document.getElementById('stage-view').classList.remove('hidden');
        
        listenToStageUsers(stageId);
    });
}

function listenToStageUsers(stageId) {
    const stageRef = db.ref('stages/' + stageId);
    
    // listen to speakers
    stageRef.child('speakers').on('value', (snapshot) => {
        const speakers = snapshot.val() || {};
        renderStageUsers(speakers, 'speakers');
    });
    
    // listen to audience
    stageRef.child('audience').on('value', (snapshot) => {
        const audience = snapshot.val() || {};
        renderStageUsers(audience, 'audience');
    });
}

function renderStageUsers(users, containerId) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    
    const usersArray = Object.entries(users);
    
    if (usersArray.length === 0) {
        container.innerHTML = '<div class="no-stages">No users</div>';
        return;
    }
    
    usersArray.forEach(([userId, user]) => {
        const card = makeUserCard(user.username, userId);
        container.appendChild(card);
    });
}

// room management
function listenToRoomUsers(roomId, roomType = 'rooms') {
    // clear old listeners
    state.listeners.forEach(ref => ref.off());
    state.listeners = [];
    
    const usersRef = db.ref(`${roomType}/${roomId}/users`);
    
    usersRef.on('value', (snapshot) => {
        const users = snapshot.val() || {};
        renderParticipants(users);
    });
    
    state.listeners.push(usersRef);
}

function renderParticipants(users) {
    const grid = document.getElementById('participants');
    grid.innerHTML = '';
    
    Object.entries(users).forEach(([userId, user]) => {
        const card = makeUserCard(user.username, userId, user);
        grid.appendChild(card);
    });
}

function makeUserCard(username, userId, userData = {}) {
    const card = document.createElement('div');
    card.className = 'participant-card';
    card.dataset.userid = userId;
    
    const isMe = userId === state.userId;
    const initial = username.charAt(0).toUpperCase();
    
    const isMuted = isMe ? state.isMuted : userData.muted;
    const isDeafened = isMe ? state.isDeafened : userData.deafened;
    const isSpeaking = userData.speaking || false;
    
    card.innerHTML = `
        <div class="avatar ${isSpeaking ? 'speaking' : ''}">
            <span>${initial}</span>
        </div>
        <div class="participant-name">${username}</div>
        <div class="participant-status">
            <i class='bx ${isMuted ? 'bx-microphone-off muted' : 'bx-microphone'}'></i>
            <i class='bx ${isDeafened ? 'bx-volume-mute muted' : 'bx-volume-full'}'></i>
        </div>
    `;
    
    return card;
}

function leaveRoom() {
    if (!state.currentRoomId) return;
    
    // figure out what type of room we're in
    const isStage = state.currentRoom && state.currentRoom.type === 'stage';
    const isCustom = state.currentRoomId.startsWith('custom_');
    
    if (isStage) {
        // remove from stage
        db.ref(`stages/${state.currentRoomId}/speakers/${state.userId}`).remove();
        db.ref(`stages/${state.currentRoomId}/audience/${state.userId}`).remove();
    } else if (isCustom) {
        db.ref(`customRooms/${state.currentRoomId}/users/${state.userId}`).remove();
    } else {
        db.ref(`rooms/${state.currentRoomId}/users/${state.userId}`).remove();
    }
    
    // clear listeners
    state.listeners.forEach(ref => ref.off());
    state.listeners = [];
    
    state.currentRoom = null;
    state.currentRoomId = null;
    
    // reset ui
    document.getElementById('default-view').classList.remove('hidden');
    document.getElementById('voice-room').classList.add('hidden');
    document.getElementById('stage-view').classList.add('hidden');
    document.getElementById('leave-room').classList.add('hidden');
    document.getElementById('current-room-name').textContent = 'Select a room';
    
    // remove active states
    document.querySelectorAll('.room-item').forEach(item => {
        item.classList.remove('active');
    });
}

function updateRoomUI() {
    if (!state.currentRoom) return;
    
    document.getElementById('current-room-name').textContent = state.currentRoom.name;
    document.getElementById('leave-room').classList.remove('hidden');
    
    // update active room
    document.querySelectorAll('.room-item').forEach(item => {
        item.classList.remove('active');
    });
}

function showVoiceRoom() {
    document.getElementById('default-view').classList.add('hidden');
    document.getElementById('voice-room').classList.remove('hidden');
    document.getElementById('stage-view').classList.add('hidden');
}

// user controls
function toggleMute() {
    state.isMuted = !state.isMuted;
    const btn = document.getElementById('mute-btn');
    const icon = btn.querySelector('i');
    
    if (state.isMuted) {
        icon.className = 'bx bx-microphone-off';
        btn.classList.add('muted');
    } else {
        icon.className = 'bx bx-microphone';
        btn.classList.remove('muted');
    }
    
    // update in firebase
    if (state.currentRoomId) {
        const isCustom = state.currentRoomId.startsWith('custom_');
        const roomPath = isCustom ? 'customRooms' : 'rooms';
        
        db.ref(`${roomPath}/${state.currentRoomId}/users/${state.userId}/muted`)
            .set(state.isMuted);
    }
}

function toggleDeafen() {
    state.isDeafened = !state.isDeafened;
    const btn = document.getElementById('deafen-btn');
    const icon = btn.querySelector('i');
    
    if (state.isDeafened) {
        icon.className = 'bx bx-volume-mute';
        btn.classList.add('muted');
        
        // auto mute when deafened
        if (!state.isMuted) {
            toggleMute();
        }
    } else {
        icon.className = 'bx bx-volume-full';
        btn.classList.remove('muted');
    }
    
    // update in firebase
    if (state.currentRoomId) {
        const isCustom = state.currentRoomId.startsWith('custom_');
        const roomPath = isCustom ? 'customRooms' : 'rooms';
        
        db.ref(`${roomPath}/${state.currentRoomId}/users/${state.userId}/deafened`)
            .set(state.isDeafened);
    }
}

// soundboard
function playSound(soundName) {
    const btn = event.target.closest('.sound-btn');
    if (btn) {
        btn.style.transform = 'scale(0.95)';
        setTimeout(() => {
            btn.style.transform = '';
        }, 100);
    }
    
    // broadcast sound to room
    if (state.currentRoomId) {
        const soundRef = db.ref(`soundboard/${state.currentRoomId}`).push();
        soundRef.set({
            sound: soundName,
            playedBy: state.username,
            timestamp: firebase.database.ServerValue.TIMESTAMP
        });
        
        // cleanup after 5 seconds
        setTimeout(() => soundRef.remove(), 5000);
    }
    
    showNotification(`🔊 ${soundName} sound played`);
    
    // trigger speaking animation
    makeMeSpeak();
}

// speaking animation
function makeMeSpeak() {
    if (!state.currentRoomId || state.isMuted) return;
    
    const isCustom = state.currentRoomId.startsWith('custom_');
    const roomPath = isCustom ? 'customRooms' : 'rooms';
    
    // set speaking to true
    db.ref(`${roomPath}/${state.currentRoomId}/users/${state.userId}/speaking`)
        .set(true);
    
    // turn off after 2 seconds
    setTimeout(() => {
        db.ref(`${roomPath}/${state.currentRoomId}/users/${state.userId}/speaking`)
            .set(false);
    }, 2000);
}

// random speaking simulation for demo
setInterval(() => {
    if (state.currentRoomId && !state.isMuted && Math.random() > 0.7) {
        makeMeSpeak();
    }
}, 5000);

// notifications
function showNotification(message) {
    const notif = document.createElement('div');
    notif.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: var(--surface);
        border: 1px solid var(--border);
        padding: 12px 20px;
        border-radius: 8px;
        z-index: 2000;
        animation: slideIn 0.3s ease;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    `;
    notif.textContent = message;
    document.body.appendChild(notif);
    
    setTimeout(() => {
        notif.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notif.remove(), 300);
    }, 2000);
}

// notification animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// listen to soundboard events
function listenToSoundboard() {
    if (!state.currentRoomId) return;
    
    const soundboardRef = db.ref(`soundboard/${state.currentRoomId}`);
    
    soundboardRef.on('child_added', (snapshot) => {
        const sound = snapshot.val();
        
        // don't show my own sounds
        if (sound.playedBy !== state.username) {
            showNotification(`🔊 ${sound.playedBy} played ${sound.sound}`);
        }
    });
    
    state.listeners.push(soundboardRef);
}

// cleanup on page close
window.addEventListener('beforeunload', () => {
    if (state.userId) {
        // leave current room
        if (state.currentRoomId) {
            leaveRoom();
        }
        
        // remove user presence
        db.ref('users/' + state.userId).remove();
    }
});