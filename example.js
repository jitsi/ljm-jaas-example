const LJM_SCRIPT = 'ljmScript';
const BASE_SOURCE = 'https://8x8.vc/libs/lib-jitsi-meet.min.js';
const BASE_SOURCE_STAGE = 'https://stage.8x8.vc/libs/lib-jitsi-meet.min.js';
const REGION_SHARD_MAPPING = {
    'default': 'default',
    'frankfurt': 'eu-central-1',
    'london': 'eu-west-2'
};
const TRANSCRIPT_LANGUAGES = [
    'en-US',
    'es-ES'
];
const INVALID_CLASS = 'is-invalid';
const HIDE_CLASS = 'd-none';

let options;
let roomName;
let token;
let releaseVersion;
let useStage;

// Visitor state. Mirrors jitsi-meet's redirect flow: when the server redirects
// us to a visitor node (vnode), we reconnect with adjusted XMPP options;
// when we are promoted back to the main room (vnode === undefined), we restore
// the original options and append a customusername param.
let preferVisitor = false;
let visitorVnode = null;
let visitorFocusJid = null;
let visitorPromotedUsername = null;

function appendURLParam(url, name, value) {
    const sep = url.indexOf('?') === -1 ? '?' : '&';

    return `${url}${sep}${name}=${encodeURIComponent(value)}`;
}

function buildOptions(tenant, room, release) {
    const selectedRegion = document.getElementById('regionInput').value;
    const hasRegion = selectedRegion !== 'default';
    const region = hasRegion ? `${selectedRegion}.` : '';
    const stage = useStage ? 'stage.' : ''
    const subdomain = useStage ? stage : region;
    const releaseVersion = release ? `&release=release-${release}` : '';

    const baseDomain = `${stage}8x8.vc`;
    let hostsDomain = baseDomain;
    let hostsMuc = `conference.${tenant}.${baseDomain}`;
    let serviceUrl = `wss://${subdomain}8x8.vc/${tenant}/xmpp-websocket?room=${room}${releaseVersion}`;
    let websocketKeepAliveUrl = `https://${subdomain}8x8.vc/${tenant}/_unlock?room=${room}`;
    // Matches jitsi-meet's config.js on 8x8.vc / stage.8x8.vc. lib-jitsi-meet
    // posts the conference-request here instead of relying on focus IQs.
    let conferenceRequestUrl = `https://${subdomain}8x8.vc/${tenant}/conference-request/v1?room=${room}`;

    // Visitor redirect: jitsi-meet's getVisitorOptions() switches the domain
    // to `${vnode}.meet.jitsi`, replaces the same in the muc, appends `vnode`
    // to the websocket URL, and sets disableFocus / disableLocalStatsBroadcast.
    const visitorOverrides = {};

    if (visitorVnode) {
        const visitorDomain = `${visitorVnode}.meet.jitsi`;

        hostsMuc = hostsMuc.replace(hostsDomain, visitorDomain);
        hostsDomain = visitorDomain;
        serviceUrl = appendURLParam(serviceUrl, 'vnode', visitorVnode);

        visitorOverrides.focusUserJid = visitorFocusJid;
        // Visitors do not send the initial conference-request to focus.
        visitorOverrides.disableFocus = true;
        visitorOverrides.disableLocalStatsBroadcast = true;
    } else if (visitorPromotedUsername) {
        // Promotion back to main room: append customusername so the new
        // connection re-uses the resource the visitor was already known by.
        // Keep disableFocus=true (jitsi-meet getVisitorOptions deliberately
        // does not reset it): if focus is enabled, jicofo would treat this
        // as a fresh conference-request and redirect us back to a vnode on
        // every promotion. With disableFocus=true we go straight to the main
        // MUC; if main is full, jicofo redirects via the MUC instead.
        serviceUrl = appendURLParam(serviceUrl, 'customusername', visitorPromotedUsername);
        visitorOverrides.focusUserJid = visitorFocusJid;
        visitorOverrides.disableFocus = true;
    }

    return {

        // Connection
        hosts: {
            domain: hostsDomain,
            muc: hostsMuc,
            focus: `focus.${stage}8x8.vc`
        },
        serviceUrl,
        websocketKeepAliveUrl,
        conferenceRequestUrl,
        hiddenDomain: `recorder.${subdomain}8x8.vc`,
        ...visitorOverrides,
        // Video quality / constraints
        constraints: {
            video: {
                height: {
                    ideal: 720,
                    max: 720,
                    min: 180
                },
                width: {
                    ideal: 1280,
                    max: 1280,
                    min: 320
                }
            }
        },
        channelLastN: 25,

        // Enable Peer-to-Peer for 1-1 calls
        p2p: {
            enabled: true
        },

        // Misc
        deploymentInfo: hasRegion ? { userRegion: REGION_SHARD_MAPPING[selectedRegion] } : {},

        // Logging
        logging: {

            // Default log level
            defaultLogLevel: 'trace',

            // The following are too verbose in their logging with the default level
            'modules/RTC/TraceablePeerConnection.js': 'info',
            'modules/statistics/CallStats.js': 'info',
            'modules/xmpp/strophe.util.js': 'log'
        },
        analytics: {
            rtcstatsEnabled: true ,
            rtcstatsStoreLogs: true ,
            rtcstatsEndpoint: `wss://rtcstats-server-${useStage ? 'pilot' : '8x8'}.jitsi.net/`,
            rtcstatsSendSdp: true,
        },

        // Visitor support: when set, the server may redirect this connection
        // to a visitor node (vnode) via CONNECTION_REDIRECTED.
        preferVisitor,

        // End marker, disregard
        __end: true
    };
}

let connection = null;
let room = null;

let localTracks = [];
const remoteTracks = {};
let receiverConstraints = {
    constraints: {},
    defaultConstraints: { 'maxHeight': '2160' },
    lastN: -1
};

const cleanupDOM = id => {
    const element = document.getElementById(id);
    element && element.remove();
};

const onLocalTracks = tracks => {
    localTracks = tracks;
    for (let i = 0; i < localTracks.length; i++) {
        if (localTracks[i].getType() === 'video') {
            const videoId = `localVideo${i}`;
            cleanupDOM(videoId);

            let videoNode = document.createElement('video');
            videoNode.id = videoId;
            videoNode.className = 'col-12 pb-2';
            videoNode.autoplay = '1';
            document.body.appendChild(videoNode);
            const localVideo = document.getElementById(videoId);
            localTracks[i].attach(localVideo);
        } else {
            const audioId = `localAudio${i}`;
            cleanupDOM(audioId);

            let audioNode = document.createElement('audio');
            audioNode.id = audioId;
            audioNode.autoplay = '1';
            document.body.appendChild(audioNode);
            const localAudio = document.getElementById(audioId)
            localTracks[i].attach(localAudio);
        }
    }
};

const onRemoteTrack = track => {
    const participant = track.getParticipantId();

    if (!remoteTracks[participant]) {
        remoteTracks[participant] = [];
    }
    const idx = remoteTracks[participant].push(track);
    const id = participant + track.getType() + idx;

    if (track.getType() === 'video') {
        const videoId = `${participant}video${idx}`;
        cleanupDOM(videoId);

        let videoNode = document.createElement('video');
        videoNode.id = videoId;
        videoNode.className = 'col-6 d-inline-block py-2';
        videoNode.autoplay = '1';
        document.body.appendChild(videoNode);
    } else {
        const audioId = `${participant}audio${idx}`;
        cleanupDOM(audioId);

        let audioNode = document.createElement('audio');
        audioNode.id = audioId;
        audioNode.autoplay = '1';
        document.body.appendChild(audioNode);
    }
    const remoteTrack = document.getElementById(id);
    track.attach(remoteTrack);
};


const onConferenceJoined = () => {
    console.log('conference joined!');
    // Mirrors jitsi-meet's middleware.any.ts: once we are in the main room,
    // clear the promotion-back state so the next reconnect (e.g. a demote)
    // does not stay on the disableFocus=true branch and silently rejoin main.
    if (!visitorVnode) {
        visitorPromotedUsername = null;
        visitorFocusJid = null;
    }
};

const onConferenceLeft = () => {
    console.log('conference left!');
};

const onDataChanelOpened = () => {
    room.setReceiverConstraints(receiverConstraints);
};

const onUserJoined = id => {
    console.log('user joined!');
};


const onUserLeft = id => {
    console.log('user left!');
};


const onConnectionSuccess = () => {
    room = connection.initJitsiConference(roomName, options);

    // Add local tracks before joining
    for (let i = 0; i < localTracks.length; i++) {
        room.addTrack(localTracks[i]);
    }

    // Setup event listeners
    room.on(
        JitsiMeetJS.events.conference.TRANSCRIPTION_STATUS_CHANGED,
        status => {
            console.log(`transcript ${status}`);
        });

    room.on(
        JitsiMeetJS.events.conference.USER_ROLE_CHANGED,
        (id, role) => {
            if (id === room.myUserId()
                && role === 'moderator'
                && room.getTranscriptionStatus() !== 'ON'
            ) {
                console.log('enable transcript');
                const selectedTranscript = document.getElementById('transcriptInput').value;
                room.dial('jitsi_meet_transcribe');
                room.setLocalParticipantProperty('requestingTranscription', true);
                room.setLocalParticipantProperty('transcription_language', selectedTranscript);
            }
        });

    room.on(
        JitsiMeetJS.events.conference.TRACK_ADDED,
        track => {
            !track.isLocal() && onRemoteTrack(track);
        });
    room.on(
        JitsiMeetJS.events.conference.CONFERENCE_JOINED,
        onConferenceJoined);
    room.on(
        JitsiMeetJS.events.conference.CONFERENCE_LEFT,
        onConferenceLeft);
    room.on(
        JitsiMeetJS.events.conference.DATA_CHANNEL_OPENED,
        onDataChanelOpened);
    room.on(
        JitsiMeetJS.events.conference.USER_JOINED,
        onUserJoined);
    room.on(
        JitsiMeetJS.events.conference.USER_LEFT,
        onUserLeft);

    room.on(JitsiMeetJS.events.conference.ENDPOINT_MESSAGE_RECEIVED, (...args) => { console.log('RECEIVED ENDPOINT MESSAGE', args) });

    // Visitor support. Mirrors react/features/visitors/middleware.ts in jitsi-meet.
    room.on(
        JitsiMeetJS.events.conference.VISITORS_SUPPORTED_CHANGED,
        supported => console.log(`visitors supported: ${supported}`));

    room.on(
        JitsiMeetJS.events.conference.VISITORS_MESSAGE,
        msg => {
            console.log('visitors message', msg);

            if (msg.action === 'promotion-request') {
                // We are a moderator and a visitor is asking to be promoted.
                // jitsi-meet shows a notification and waits for an
                // approve/deny action; here we expose a global helper.
                if (msg.on) {
                    console.log(
                        `visitor ${msg.nick || msg.from} requested promotion. `
                        + `Call approveVisitor('${msg.from}') or denyVisitor('${msg.from}') to respond.`);
                }
            } else if (msg.action === 'demote-request') {
                // We have been asked to become a visitor. Reconnect with
                // preferVisitor = true so the server redirects us to a vnode.
                // Clear any leftover promotion-back state, otherwise
                // buildOptions takes the customusername + disableFocus branch
                // and we silently rejoin main instead of getting redirected.
                const localId = room.myUserId();
                if (localId === msg.id) {
                    console.log(`demoted to visitor by ${msg.actor}`);
                    preferVisitor = true;
                    visitorVnode = null;
                    visitorFocusJid = null;
                    visitorPromotedUsername = null;
                    reload();
                }
            }
        });

    room.on(
        JitsiMeetJS.events.conference.VISITORS_REJECTION,
        () => {
            console.log('promotion request rejected');
            // Lower hand to clear the pending state.
            room.setLocalParticipantProperty('raisedHand', 0);
        });

    // Join
    room.join();
    room.setSenderVideoConstraint(720);  // Send at most 720p
    room.setReceiverVideoConstraint(360);  // Receive at most 360p for each participant
};


const onConnectionFailed = () => {
    console.error('connection failed!');
};

// Server is asking us to reconnect to a different shard. When vnode is set we
// are being moved to a visitor node; when it is undefined we are being
// promoted back to the main room (and username carries the resource we
// should rejoin under, mirroring jitsi-meet's getVisitorOptions()).
const onConnectionRedirected = async (vnode, focusJid, username) => {
    console.log(`connection redirected: vnode=${vnode} focusJid=${focusJid} username=${username}`);

    visitorVnode = vnode;
    visitorFocusJid = focusJid;
    visitorPromotedUsername = vnode ? null : username;
    // Clear preferVisitor: the redirect itself is the server's response to it.
    preferVisitor = false;

    removeRemoteTracks();
    await disconnect();
    await connect();
};

// Visitors request promotion by raising their hand; lib-jitsi-meet translates
// the raisedHand property into a promotion-request to the main room.
const requestPromotion = () => {
    if (!room) {
        return;
    }
    room.setLocalParticipantProperty('raisedHand', Date.now());
    console.log('promotion request sent (raised hand)');
};

// Moderator helpers. The promotion-response endpoint message format matches
// react/features/visitors/actions.ts in jitsi-meet.
const approveVisitor = id => {
    room && room.sendMessage({
        type: 'visitors',
        action: 'promotion-response',
        approved: true,
        id
    });
};

const denyVisitor = id => {
    room && room.sendMessage({
        type: 'visitors',
        action: 'promotion-response',
        approved: false,
        id
    });
};

window.requestPromotion = requestPromotion;
window.approveVisitor = approveVisitor;
window.denyVisitor = denyVisitor;

const isTenantValid = () => {
    if (!tenantInput.value.startsWith('vpaas-magic-cookie-')) {
        tenantInput.classList.add(INVALID_CLASS);
        return false;
    }

    if (tenantInput.classList.contains(INVALID_CLASS)) {
        tenantInput.classList.remove(INVALID_CLASS);
    }

    return true;
};

const isRoomValid = () => {
    if (!roomInput.value) {
        roomInput.classList.add(INVALID_CLASS);
        return false;
    }

    if (roomInput.classList.contains(INVALID_CLASS)) {
        roomInput.classList.remove(INVALID_CLASS);
    }

    return true;
};

const isConfigValid = () => {
    const validTenant = isTenantValid();
    const validRoom = isRoomValid();

    return validTenant && validRoom;
};

const connect = async () => {
    if (!isConfigValid()) {
        console.log('invalid configuration!');
        return;
    }

    const tenant = document.getElementById('tenantInput').value;
    token = document.getElementById('tokenInput').value;
    roomName = document.getElementById('roomInput').value;

    options = buildOptions(tenant, roomName, releaseVersion);

    // Initialize lib-jitsi-meet
    JitsiMeetJS.init(options);

    // Initialize logging.
    JitsiMeetJS.setLogLevel(options.logging.defaultLogLevel);
    for (const [loggerId, level] of Object.entries(options.logging)) {
        if (loggerId !== 'defaultLogLevel') {
            JitsiMeetJS.setLogLevelById(level, loggerId);
        }
    }

    // Visitors join without any sources. jitsi-meet calls destroyLocalTracks()
    // on the redirect and only sets up startup media after promotion back.
    if (!preferVisitor && !visitorVnode) {
        const tracks = await JitsiMeetJS.createLocalTracks({ devices: ['audio', 'video'] });
        onLocalTracks(tracks);
    }

    connection = new JitsiMeetJS.JitsiConnection(null, token, options);
    console.log(`using LJM version ${JitsiMeetJS.version}!`);

    connection.addEventListener(
        JitsiMeetJS.events.connection.CONNECTION_ESTABLISHED,
        onConnectionSuccess);
    connection.addEventListener(
        JitsiMeetJS.events.connection.CONNECTION_FAILED,
        onConnectionFailed);
    connection.addEventListener(
        JitsiMeetJS.events.connection.CONNECTION_DISCONNECTED,
        disconnect);
    connection.addEventListener(
        JitsiMeetJS.events.connection.CONNECTION_REDIRECTED,
        onConnectionRedirected);

    return connection.connect();
};

// [testing purposes] Cleanup DOM of remote tracks.
const removeRemoteTracks = () => {
    const remoteVideo = document.getElementsByTagName('video');
    const remoteAudio = document.getElementsByTagName('audio');

    for (let i = remoteVideo.length - 1; i >= 0; i--) {
        remoteVideo[i].remove();
    }
    for (let i = remoteAudio.length - 1; i >= 0; i--) {
        remoteAudio[i].remove();
    }
};


// Close all resources when closing the page.
const disconnect = async () => {
    console.log('disconnect!');

    connection.removeEventListener(
        JitsiMeetJS.events.connection.CONNECTION_ESTABLISHED,
        onConnectionSuccess);
    connection.removeEventListener(
        JitsiMeetJS.events.connection.CONNECTION_FAILED,
        onConnectionFailed);
    connection.removeEventListener(
        JitsiMeetJS.events.connection.CONNECTION_DISCONNECTED,
        disconnect);
    connection.removeEventListener(
        JitsiMeetJS.events.connection.CONNECTION_REDIRECTED,
        onConnectionRedirected);

    for (let i = 0; i < localTracks.length; i++) {
        localTracks[i].dispose();
    }
    localTracks = [];

    return await connection.disconnect();
};

// Restart the connection.
const reload = async () => {

    // [testing purposes] Disconnect all participants to apply the latest release.
    removeRemoteTracks();

    await disconnect();
    await connect();
};

// Leave the room and proceed to cleanup.
const hangup = async () => {
    removeRemoteTracks();

    if (room) {
        await room.leave();
    }

    await disconnect();
};

const addRegionsOptions = () => {
    const regionInput = document.getElementById('regionInput');
    Object.keys(REGION_SHARD_MAPPING).forEach(region => {
        const optionElem = document.createElement('option');
        optionElem.value = region;
        const upper = `${region[0].toUpperCase()}${region.substring(1)}`;
        optionElem.text = upper;
        regionInput.appendChild(optionElem);
    });
};

const addTranscriptOptions = () => {
    const transcriptInput = document.getElementById('transcriptInput');
    TRANSCRIPT_LANGUAGES.forEach(transcript => {
        const optionElem = document.createElement('option');
        optionElem.value = transcript;
        optionElem.text = transcript;
        transcriptInput.appendChild(optionElem);
    });
};

// [testing purposes] Notify that a connection reload is necessary to apply a different ljm script.
const signalReload = () => {
    const RELOAD_BUTTON = 'reloadButton';
    if (document.getElementById(RELOAD_BUTTON) || !document.getElementsByTagName('video').length) {
        return;
    }

    let reloadButton = document.createElement('button');
    reloadButton.id = RELOAD_BUTTON;
    reloadButton.className = 'btn btn-outline-secondary bi bi-arrow-clockwise';
    goButton.parentElement.appendChild(reloadButton);

    reloadButton.addEventListener('click', async () => {
        reload();
        reloadButton.remove();
    });
};

const updateLjmScript = (releaseVersionValue, shouldUseStage) => {
    console.log(`removing LJM version ${JitsiMeetJS.version}!`);

    const currentVersionScript = document.getElementById(LJM_SCRIPT);
    const releaseVersionParam = releaseVersionValue ? `?release=release-${releaseVersionValue}` : '';
    const baseSource = shouldUseStage ? BASE_SOURCE_STAGE : BASE_SOURCE;
    let nextVersionScript = document.createElement('script');
    nextVersionScript.id = LJM_SCRIPT;
    nextVersionScript.src = `${baseSource}${releaseVersionParam}`

    currentVersionScript.remove();
    document.body.appendChild(nextVersionScript);

    signalReload();
};

const handleReleaseUpdate = async event => {
    if ((!releaseVersion && !event.target.value) || releaseVersion === event.target.value) {
        return;
    }

    releaseVersion = event.target.value;
    updateLjmScript(releaseVersion, useStage);
};

const handleUseStageUpdate = async event => {
    useStage = event.target.checked;

    const regionInputParent = document.getElementById('regionInput').parentElement;
    if (useStage) {
        regionInputParent.classList.add(HIDE_CLASS);
    } else {
        regionInputParent.classList.contains(HIDE_CLASS) && regionInputParent.classList.remove(HIDE_CLASS);
    }

    updateLjmScript(releaseVersion, useStage);
};

window.addEventListener('beforeunload', disconnect);
window.addEventListener('unload', disconnect);

document.addEventListener('DOMContentLoaded', () => {
    addRegionsOptions();
    addTranscriptOptions();
    const form = document.getElementById('form');
    const tenantInput = document.getElementById('tenantInput');
    const roomInput = document.getElementById('roomInput');
    const releaseInput = document.getElementById('releaseInput');
    const useStageInput = document.getElementById('useStageInput');
    const goButton = document.getElementById('goButton');
    const hangupButton = document.getElementById('hangupButton');
    const promoteButton = document.getElementById('promoteButton');

    form.addEventListener('submit', event => event.preventDefault());
    if (promoteButton) {
        promoteButton.addEventListener('click', requestPromotion);
    }
    tenantInput.addEventListener('blur', isTenantValid);
    roomInput.addEventListener('blur', isRoomValid);
    releaseInput.addEventListener('blur', handleReleaseUpdate);
    useStageInput.addEventListener('change', handleUseStageUpdate);
    goButton.addEventListener('click', connect);
    hangupButton.addEventListener('click', hangup);
});
