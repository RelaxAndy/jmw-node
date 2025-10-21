import {
    initializeApp
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import {
    getDatabase,
    ref,
    set,
    onValue,
    push,
    remove,
    onDisconnect,
    update
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';

const firebaseConfig = {
    apiKey: "AIzaSyC7jhfwo8pX2M0ux0Vtt0di2As9mUfH-7s",
    authDomain: "voicechat-global.firebaseapp.com",
    databaseURL: "https://voicechat-global-default-rtdb.firebaseio.com",
    projectId: "voicechat-global",
    storageBucket: "voicechat-global.firebasestorage.app",
    messagingSenderId: "810575934201",
    appId: "1:810575934201:web:7bfb46b12243f6d9d22828",
    measurementId: "G-GSJWGXFEET"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

let username = '';
let currentRoom = null;
let userRef = null;
let isMuted = false;
let stream = null;
let roomType = '';
let peerConnections = {};
let myPeerId = null;
let audioContext = null;
let analyserNodes = {};
let localAnalyser = null;
let pendingCandidates = {};

const iceServers = {
    iceServers: [{
            urls: 'stun:stun.l.google.com:19302'
        },
        {
            urls: 'stun:stun1.l.google.com:19302'
        }
    ]
};

function getInitials(name) {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

function checkUsername() {
    const saved = localStorage.getItem('voiceChatUsername');
    if (saved) {
        username = saved;
        document.getElementById('usernameInput').value = saved;
    } else {
        document.getElementById('usernameModal').classList.add('show');
    }
}

function setUsername() {
    const input = document.getElementById('usernameInput').value.trim();
    if (input) {
        username = input;
        localStorage.setItem('voiceChatUsername', username);
        document.getElementById('usernameModal').classList.remove('show');
    }
}

function initDefaults() {
    ['General Chat', 'Game Chat'].forEach(name => {
        const roomRef = ref(db, `rooms/default/${name.replace(/\s+/g, '_')}`);
        
        // Only create if it doesn't exist
        onValue(roomRef, (snap) => {
            if (!snap.exists()) {
                set(roomRef, {
                    name: name,
                    type: 'default',
                    created: Date.now()
                });
            }
        }, { onlyOnce: true });
    });
}

initDefaults();

function listenRooms() {
    onValue(ref(db, 'rooms/default'), (snap) => displayRooms(snap, 'defaultRooms', 'default'));
    onValue(ref(db, 'rooms/public'), (snap) => displayRooms(snap, 'publicRooms', 'public'));
    onValue(ref(db, 'rooms/private'), (snap) => displayRooms(snap, 'privateRooms', 'private'));
}

function displayRooms(snap, containerId, type) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    container.innerHTML = '';

    if (snap.exists()) {
        snap.forEach((child) => {
            const room = child.val();
            const id = child.key;

            let count = 0;
            if (room.participants) {
                count = Object.keys(room.participants).length;
            }

            const div = document.createElement('div');
            div.className = 'room';
            if (currentRoom === id) div.classList.add('active');

            div.innerHTML = `
                <span>${room.name} ${room.password ? '<i class="bx bx-lock-alt"></i>' : ''}</span>
                <span class="room-count">${count}</span>
            `;

            div.onclick = () => joinRoom(id, type, room.name, room.password);
            container.appendChild(div);
        });
    }
}

async function joinRoom(id, type, name, hasPassword) {
    if (!username) {
        document.getElementById('usernameModal').classList.add('show');
        return;
    }

    if (hasPassword) {
        const pass = prompt('Password:');
        if (pass !== hasPassword) {
            alert('Wrong password!');
            return;
        }
    }

    if (currentRoom) await leaveRoom();

    currentRoom = id;
    roomType = type;
    myPeerId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    const roomTitle = document.getElementById('roomTitle');
    if (roomTitle) roomTitle.textContent = name;

    try {
        stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        
        audioContext = new(window.AudioContext || window.webkitAudioContext)();
        
        // Setup local audio monitoring
        const source = audioContext.createMediaStreamSource(stream);
        localAnalyser = audioContext.createAnalyser();
        localAnalyser.fftSize = 256;
        source.connect(localAnalyser);
        monitorAudio(myPeerId, localAnalyser);
        
    } catch (err) {
        alert('Microphone access denied!');
        console.error(err);
        return;
    }

    userRef = ref(db, `rooms/${type}/${id}/participants/${myPeerId}`);
    const joinTime = Date.now();
    
    await set(userRef, {
        username: username,
        joined: joinTime,
        muted: isMuted
    });

    onDisconnect(userRef).remove();

    onValue(ref(db, `rooms/${type}/${id}/participants`), (snap) => {
        const container = document.getElementById('participants');
        if (!container) return;
        
        container.innerHTML = '';
        let count = 0;

        if (snap.exists()) {
            snap.forEach((child) => {
                const p = child.val();
                const peerId = child.key;
                count++;

                const div = document.createElement('div');
                div.className = 'participant';
                div.innerHTML = `
                    <div class="avatar-wrapper">
                        <div class="avatar-ring" id="ring-${peerId}"></div>
                        <div class="avatar">${getInitials(p.username)}</div>
                    </div>
                    <div class="participant-name">${p.username}</div>
                    <div class="participant-status">${p.muted ? '<i class="bx bx-microphone-off"></i>' : '<i class="bx bx-microphone"></i>'}</div>
                `;
                container.appendChild(div);

                if (peerId !== myPeerId && !peerConnections[peerId]) {
                    createPeerConnection(peerId);
                }
            });
        }

        const countEl = document.getElementById('count');
        if (countEl) countEl.textContent = count;

        // Clean up disconnected peers
        Object.keys(peerConnections).forEach(peerId => {
            if (!snap.child(peerId).exists()) {
                closePeerConnection(peerId);
            }
        });
    });

    onValue(ref(db, `rooms/${type}/${id}/signals/${myPeerId}`), (snap) => {
        if (snap.exists()) {
            snap.forEach(async (child) => {
                const signal = child.val();
                const fromPeer = signal.from;

                if (signal.type === 'offer') {
                    await handleOffer(fromPeer, signal.offer);
                } else if (signal.type === 'answer') {
                    await handleAnswer(fromPeer, signal.answer);
                } else if (signal.type === 'candidate') {
                    await handleCandidate(fromPeer, signal.candidate);
                }

                remove(child.ref);
            });
        }
    });
}

function createPeerConnection(peerId) {
    const pc = new RTCPeerConnection(iceServers);
    peerConnections[peerId] = pc;

    stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
    });

    pc.ontrack = (event) => {
        const audio = new Audio();
        audio.srcObject = event.streams[0];
        audio.autoplay = true;
        audio.play().catch(e => console.log('Audio play failed:', e));

        const source = audioContext.createMediaStreamSource(event.streams[0]);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyserNodes[peerId] = analyser;

        monitorAudio(peerId, analyser);
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            sendSignal(peerId, {
                type: 'candidate',
                candidate: event.candidate.toJSON(),
                from: myPeerId
            });
        }
    };

    pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
            closePeerConnection(peerId);
        }
    };

    createOffer(peerId);
}

function monitorAudio(peerId, analyser) {
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    function check() {
        if (!analyserNodes[peerId] && peerId !== myPeerId) return;
        if (peerId === myPeerId && !localAnalyser) return;

        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b) / dataArray.length;

        const ring = document.getElementById(`ring-${peerId}`);
        if (ring) {
            if (average > 30) {
                ring.classList.add('speaking');
            } else {
                ring.classList.remove('speaking');
            }
        }

        requestAnimationFrame(check);
    }
    check();
}

async function createOffer(peerId) {
    const pc = peerConnections[peerId];
    if (!pc) return;

    try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        sendSignal(peerId, {
            type: 'offer',
            offer: offer,
            from: myPeerId
        });
    } catch (err) {
        console.error('Error creating offer:', err);
    }
}

async function handleOffer(fromPeer, offer) {
    // If peer connection exists and is in wrong state, close and recreate
    if (peerConnections[fromPeer]) {
        const pc = peerConnections[fromPeer];
        if (pc.signalingState !== 'stable' && pc.signalingState !== 'closed') {
            console.log('Peer in wrong state, recreating:', pc.signalingState);
            closePeerConnection(fromPeer);
        }
    }
    
    if (!peerConnections[fromPeer]) {
        const pc = new RTCPeerConnection(iceServers);
        peerConnections[fromPeer] = pc;

        stream.getTracks().forEach(track => {
            pc.addTrack(track, stream);
        });

        pc.ontrack = (event) => {
            const audio = new Audio();
            audio.srcObject = event.streams[0];
            audio.autoplay = true;
            audio.play().catch(e => console.log('Audio play failed:', e));

            const source = audioContext.createMediaStreamSource(event.streams[0]);
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);
            analyserNodes[fromPeer] = analyser;

            monitorAudio(fromPeer, analyser);
        };

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                sendSignal(fromPeer, {
                    type: 'candidate',
                    candidate: event.candidate.toJSON(),
                    from: myPeerId
                });
            }
        };

        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
                closePeerConnection(fromPeer);
            }
        };
    }

    const pc = peerConnections[fromPeer];
    
    try {
        // Check if we're in the right state
        if (pc.signalingState !== 'stable' && pc.signalingState !== 'have-remote-offer') {
            console.log('Cannot handle offer in state:', pc.signalingState);
            return;
        }
        
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        
        // Process any queued candidates
        if (pendingCandidates[fromPeer]) {
            for (const candidate of pendingCandidates[fromPeer]) {
                try {
                    await pc.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (e) {
                    console.error('Error adding queued candidate:', e);
                }
            }
            delete pendingCandidates[fromPeer];
        }
        
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        sendSignal(fromPeer, {
            type: 'answer',
            answer: answer,
            from: myPeerId
        });
    } catch (err) {
        console.error('Error handling offer:', err);
        // If there's an error, try to recover by closing the connection
        closePeerConnection(fromPeer);
    }
}

async function handleAnswer(fromPeer, answer) {
    const pc = peerConnections[fromPeer];
    if (!pc) {
        console.log('No peer connection for answer from:', fromPeer);
        return;
    }
    
    try {
        // Only set remote description if we're waiting for an answer
        if (pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(answer));
        } else {
            console.log('Ignoring answer, wrong state:', pc.signalingState);
        }
    } catch (err) {
        console.error('Error handling answer:', err);
    }
}

async function handleCandidate(fromPeer, candidate) {
    const pc = peerConnections[fromPeer];
    
    if (!pc) {
        console.log('No peer connection for candidate from:', fromPeer);
        return;
    }
    
    try {
        // If remote description is set, add candidate immediately
        if (pc.remoteDescription && pc.remoteDescription.type) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } else {
            // Queue candidate for later
            if (!pendingCandidates[fromPeer]) {
                pendingCandidates[fromPeer] = [];
            }
            pendingCandidates[fromPeer].push(candidate);
            console.log('Queued candidate for', fromPeer);
        }
    } catch (err) {
        console.error('Error adding ICE candidate:', err);
    }
}

function sendSignal(toPeer, signal) {
    if (!currentRoom || !roomType) return;
    
    const signalRef = push(ref(db, `rooms/${roomType}/${currentRoom}/signals/${toPeer}`));
    set(signalRef, signal);
}

function closePeerConnection(peerId) {
    if (peerConnections[peerId]) {
        peerConnections[peerId].close();
        delete peerConnections[peerId];
    }
    if (analyserNodes[peerId]) {
        delete analyserNodes[peerId];
    }
}

async function leaveRoom() {
    if (userRef) await remove(userRef);
    if (stream) stream.getTracks().forEach(t => t.stop());

    Object.keys(peerConnections).forEach(peerId => {
        closePeerConnection(peerId);
    });

    if (currentRoom && roomType && myPeerId) {
        await remove(ref(db, `rooms/${roomType}/${currentRoom}/signals/${myPeerId}`));
    }

    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }

    localAnalyser = null;
    currentRoom = null;
    userRef = null;
    stream = null;
    myPeerId = null;
    peerConnections = {};
    analyserNodes = {};
    
    const roomTitle = document.getElementById('roomTitle');
    const participants = document.getElementById('participants');
    const count = document.getElementById('count');
    
    if (roomTitle) roomTitle.textContent = 'Select a room to join';
    if (participants) participants.innerHTML = '';
    if (count) count.textContent = '0';
}

function toggleMic() {
    if (!stream) return;

    isMuted = !isMuted;
    
    stream.getAudioTracks().forEach(track => {
        track.enabled = !isMuted;
    });

    const btn = document.getElementById('micBtn');
    const icon = document.getElementById('micIcon');
    const text = document.getElementById('micText');

    if (btn && icon && text) {
        if (isMuted) {
            btn.classList.add('muted');
            icon.className = 'bx bx-microphone-off';
            text.textContent = 'Muted';
        } else {
            btn.classList.remove('muted');
            icon.className = 'bx bx-microphone';
            text.textContent = 'Unmuted';
        }
    }

    if (userRef) {
        update(userRef, {
            muted: isMuted
        });
    }
}

function showCreateModal(type) {
    if (!username) {
        document.getElementById('usernameModal').classList.add('show');
        return;
    }
    roomType = type;
    
    const modal = document.getElementById('createModal');
    const passwordGroup = document.getElementById('passwordGroup');
    
    if (modal) modal.classList.add('show');
    if (passwordGroup) passwordGroup.style.display = type === 'private' ? 'block' : 'none';
}

function hideCreateModal() {
    const modal = document.getElementById('createModal');
    const roomNameInput = document.getElementById('roomNameInput');
    const passwordInput = document.getElementById('passwordInput');
    
    if (modal) modal.classList.remove('show');
    if (roomNameInput) roomNameInput.value = '';
    if (passwordInput) passwordInput.value = '';
}

function createRoom() {
    const nameInput = document.getElementById('roomNameInput');
    const passInput = document.getElementById('passwordInput');
    
    if (!nameInput) return;
    
    const name = nameInput.value.trim();
    const pass = passInput ? passInput.value.trim() : '';

    if (!name) {
        alert('Enter room name!');
        return;
    }

    const id = name.replace(/\s+/g, '_');
    const data = {
        name: name,
        type: roomType,
        creator: username,
        created: Date.now()
    };

    if (pass && roomType === 'private') data.password = pass;

    set(ref(db, `rooms/${roomType}/${id}`), data);
    hideCreateModal();
}

// Export functions to window
window.setUsername = setUsername;
window.toggleMic = toggleMic;
window.leaveRoom = leaveRoom;
window.showCreateModal = showCreateModal;
window.hideCreateModal = hideCreateModal;
window.createRoom = createRoom;

// Event listeners
const usernameInput = document.getElementById('usernameInput');
if (usernameInput) {
    usernameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') setUsername();
    });
}

// Initialize
checkUsername();
listenRooms();