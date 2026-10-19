# 🎾 Tennis TV

Un gioco di tennis in stile Wii Sports che si gioca sulla TV usando **i telefoni come racchette**.
La racchetta sullo schermo segue i movimenti del telefono e gli swing si rilevano con giroscopio e accelerometro.

- **TV**: apri `index.html` nel browser della TV (o di un PC/portatile collegato alla TV con HDMI).
- **Telefoni**: inquadra il QR code mostrato sulla TV. Si apre la pagina “Racchetta” (`controller.html`).
- **Singolo**: 1 telefono = tu contro la CPU, 2 telefoni = sfida a due.
- **Doppio 2 contro 2**: fino a 4 telefoni (squadra rossa contro squadra blu). I posti liberi li occupa la CPU, quindi si può fare anche 2 amici contro 2 CPU. Dal telefono si può cambiare squadra.
- **Pausa** in qualsiasi momento: tasto ⏸ sul telefono, oppure P / Esc sulla tastiera. Se un telefono si scollega la partita va in pausa da sola.
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

- **Spostamenti automatici**: come su Wii, il personaggio corre da solo verso la palla. Tu fai lo swing quando la palla è vicina: puoi colpirla subito, anche se è alta o prima che rimbalzi (volée).
- **Direzione**: conta l'angolo della racchetta (cioè del telefono) al momento dell'impatto. Racchetta perpendicolare alla rete = palla dritta, punta in avanti = incrociato, punta indietro = dall'altra parte. Conta anche il tempismo.
- **Forza**: lo swing viene misurato su una scala ampia: appena accennato = palla lenta, normale ≈ 90 km/h, fortissimo = oltre 115 km/h (ma meno preciso).
- **Effetti**: swing dal basso verso l'alto = top spin (palla arcuata che scende e rimbalza alta), dall'alto verso il basso = slice (palla bassa).
- **Colpi particolari**: piano e dal basso verso l'alto = pallonetto; piano e dall'alto verso il basso = palla corta; palla alta + swing = smash.
- **Al volo**: se fai lo swing molto in anticipo, mentre la palla è ancora in volo, il giocatore scatta in avanti e la colpisce prima che tocchi il campo.
- **Colpi speciali ⚡ "PACIULLO"**: ogni colpo riempie la barra dell'energia (sul telefono e sulla TV). Quando è piena, **salta** (salto vero con il telefono in mano, oppure il tasto ⚡ Salta sul telefono) e colpisci: la palla parte con una scia viola e il giocatore grida "PACIULLOOOO!".
  - swing normale o forte = **Fulmine**: velocissimo e radente;
  - dal basso verso l'alto = **Meteora**: sale altissima e precipita sulla riga di fondo;
  - dall'alto verso il basso = **Serpente**: fa lo slalom in aria.
- **Esultanze**: chi vince il punto esulta (braccia al cielo, pugno, giravolta, inchino, salto), chi lo perde abbassa la testa.
- **Animali**: ogni tanto, quando colpisci, si sente il verso di un animale (mucca, pecora, gatto, cane, anatra, gallo, asino, leone, rana).
- **Servizio**: primo swing per lanciare la palla, secondo swing quando la palla è in alto. Colpirla vicino al punto più alto dà il servizio migliore; la velocità compare in km/h.
- **Atmosfera**: brusio del pubblico che si zittisce durante lo scambio, applausi più forti dopo gli scambi lunghi, "oooh" sulle palle vicino alla riga, boati sugli ace. Gli spettatori seguono la palla con la testa, applaudono, si alzano a braccia alzate e sventolano le bandiere.
- Punteggio tennistico vero: 15-30-40, parità, vantaggi, falli e doppi falli. L'arbitro annuncia il punteggio (se il browser della TV supporta la sintesi vocale).

Senza telefono puoi provare il gioco dalla tastiera: **Invio** per iniziare, **Spazio** per lo swing (**Shift+Spazio** forte), **↑** pallonetto, **↓** slice, **← →** per mirare, **J** per saltare, **P/Esc** per la pausa.

## Consigli

- TV e telefoni devono avere internet (serve per far “trovarsi” i dispositivi; poi i dati viaggiano direttamente sulla rete locale).
- Se il browser della smart TV è lento o non supporta WebGL, usa un portatile collegato con HDMI, oppure trasmetti la scheda del browser con Chromecast.
- Se gli swing partono troppo facilmente (o non partono), regola **Sensibilità swing** nelle impostazioni della pagina Racchetta.
- Se la racchetta “gira” storta col passare del tempo (deriva della bussola), ripremi **Calibra**.
- Per far partire l'audio sulla TV clicca o premi un tasto una volta.
- Se il dispositivo collegato alla TV è lento, il gioco spegne da solo le ombre per restare fluido.

## Struttura

| File | Cosa fa |
| --- | --- |
| `index.html`, `css/tv.css` | Pagina della TV: lobby, tabellone, messaggi, pausa |
| `js/game.js` | Fisica della palla (gravità, aria, effetti), regole e punteggio di singolo e doppio, CPU, pausa, connessione con i telefoni |
| `js/scene.js` | Grafica 3D (three.js): campo, stadio, pubblico animato, luci e ombre |
| `js/athlete.js` | Modello dei tennisti, con braccia e gambe articolate, salto ed esultanze |
| `js/crowd.js` | Pubblico 3D animato |
| `js/audio.js` | Suoni sintetizzati: colpi, rimbalzi, pubblico |
| `controller.html`, `css/controller.css`, `js/controller.js` | Pagina del telefono: sensori, rilevamento swing, calibrazione, opzioni |
| `js/config.js` | Impostazioni condivise (ID PeerJS, colori dei giocatori) |
| `vendor/` | Librerie incluse: three.js, PeerJS, qrcode-generator (licenze in `vendor/LICENSES.md`) |

Per provarlo in locale: `python3 -m http.server` nella cartella e apri `http://localhost:8000` (i telefoni però avranno bisogno della versione https).
