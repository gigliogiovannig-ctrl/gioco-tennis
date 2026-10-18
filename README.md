# 🎾 Tennis TV

Un gioco di tennis in stile Wii Sports che si gioca sulla TV usando **i telefoni come racchette**.
La racchetta sullo schermo segue i movimenti del telefono e gli swing si rilevano con giroscopio e accelerometro.

- **TV**: apri `index.html` nel browser della TV (o di un PC/portatile collegato alla TV con HDMI).
- **Telefoni**: inquadra il QR code mostrato sulla TV. Si apre la pagina “Racchetta” (`controller.html`).
- **1 telefono** = tu contro la CPU. **2 telefoni** = sfida a due.
- Non serve installare niente: è tutto nel browser. I telefoni comunicano con la TV via WebRTC (PeerJS).

## Come pubblicarlo (una volta sola)

I sensori di movimento dei telefoni funzionano solo su pagine **https**, quindi il modo più semplice è GitHub Pages:

1. Unisci questo branch in `main` (oppure scegli direttamente questo branch al punto 3).
2. Su GitHub apri il repository → **Settings** → **Pages**.
3. In “Build and deployment” scegli **Deploy from a branch**, branch `main`, cartella `/ (root)` e premi **Save**.
4. Dopo un minuto il gioco è online su `https://<tuo-utente>.github.io/gioco-tennis/`.

## Come si gioca

1. Apri l'indirizzo del gioco sulla TV. Compare la lobby con QR code e codice stanza (4 caratteri).
2. Sul telefono inquadra il QR (oppure apri `…/controller.html` e scrivi il codice), inserisci il nome, scegli destro/mancino e premi **Connetti**. Su iPhone consenti l'accesso a “Movimento e orientamento”.
3. Impugna il telefono come il manico della racchetta: **la parte alta del telefono è la testa della racchetta**, lo schermo è la faccia delle corde.
4. Punta il telefono verso la TV e premi **Calibra**. Da qui in poi la racchetta a schermo segue il telefono (puoi ricalibrare quando vuoi).
5. Il Giocatore 1 sceglie le opzioni e preme **Inizia partita** (sul telefono o con Invio sulla TV).

Durante la partita:

- **Spostamenti automatici**: come su Wii, il personaggio corre da solo verso la palla. Tu devi solo fare lo swing al momento giusto.
- **Tempismo**: swing in anticipo = palla incrociata, in ritardo = lungo linea. Più sei estremo, più rischi di mandarla fuori.
- **Forza**: più lo swing è veloce, più il colpo è potente e profondo (ma meno preciso).
- **Effetti**: swing dal basso verso l'alto = top spin, dall'alto verso il basso = slice. Uno swing lentissimo fa un pallonetto.
- **Servizio**: primo swing per lanciare la palla, secondo swing quando la palla è in alto. Colpirla vicino al punto più alto dà il servizio migliore.
- Punteggio tennistico vero: 15-30-40, parità, vantaggi, falli e doppi falli. L'arbitro annuncia il punteggio (se il browser della TV supporta la sintesi vocale).

Senza telefono puoi provare il gioco dalla tastiera: **Invio** per iniziare, **Spazio** per lo swing, **Esc** per tornare alla lobby.

## Consigli

- TV e telefoni devono avere internet (serve per far “trovarsi” i dispositivi; poi i dati viaggiano direttamente sulla rete locale).
- Se il browser della smart TV è lento o non supporta WebGL, usa un portatile collegato con HDMI, oppure trasmetti la scheda del browser con Chromecast.
- Se gli swing partono troppo facilmente (o non partono), regola **Sensibilità swing** nelle impostazioni della pagina Racchetta.
- Se la racchetta “gira” storta col passare del tempo (deriva della bussola), ripremi **Calibra**.
- Per far partire l'audio sulla TV clicca o premi un tasto una volta.

## Struttura

| File | Cosa fa |
| --- | --- |
| `index.html`, `css/tv.css` | Pagina della TV: lobby, tabellone, messaggi |
| `js/game.js` | Grafica 3D (three.js), fisica della palla, regole e punteggio, CPU, connessione con i telefoni |
| `controller.html`, `css/controller.css`, `js/controller.js` | Pagina del telefono: sensori, rilevamento swing, calibrazione, opzioni |
| `js/config.js` | Impostazioni condivise (ID PeerJS, colori dei giocatori) |
| `vendor/` | Librerie incluse: three.js, PeerJS, qrcode-generator (licenze in `vendor/LICENSES.md`) |

Per provarlo in locale: `python3 -m http.server` nella cartella e apri `http://localhost:8000` (i telefoni però avranno bisogno della versione https).
