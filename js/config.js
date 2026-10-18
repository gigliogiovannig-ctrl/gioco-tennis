// Impostazioni condivise tra TV e telefoni.

// Prefisso degli ID PeerJS: la TV si registra come PEER_PREFIX + codice stanza.
export const PEER_PREFIX = 'tennis-tv-gg-';

// Opzioni del server di segnalazione PeerJS (vuoto = server pubblico gratuito 0.peerjs.com).
export const PEER_OPTIONS = { debug: 1 };

// 4 posti: 0 e 2 = squadra rossa (vicino alla telecamera), 1 e 3 = squadra blu.
export const PLAYER_COLORS = ['#e53935', '#1e88e5', '#fb8c00', '#00acc1'];
export const PLAYER_COLOR_NAMES = ['Rosso', 'Blu', 'Arancione', 'Azzurro'];
export const TEAM_NAMES = ['Squadra rossa', 'Squadra blu'];
