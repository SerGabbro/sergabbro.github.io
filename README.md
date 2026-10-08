# Gabbro

Note tecniche di un ingegnere elettronico: reti, sicurezza dei sistemi, Linux, elettronica e strumenti interattivi.

🌐 [sergabbro.github.io](https://sergabbro.github.io)

## Struttura

- `index.html` — home
- `articles/` — articoli
- `tools/` — strumenti interattivi (Math Canvas, Laboratorio di campionamento, Laboratorio antenne)
- `assets/css/`
  - `base.css` — token, reset, navbar, footer, elementi comuni (tutte le pagine)
  - `home.css` — hero, card, "Chi sono"
  - `article.css` — layout e tipografia degli articoli, codice, callout, tabelle, indice
  - `diagrams.css` — schemi HTML/CSS usati negli articoli
  - `math-canvas.css` — stile dello strumento Math Canvas
  - `sampling.css` — Laboratorio di campionamento (usa anche `base.css` e `article.css`)
  - `antenne.css` — Laboratorio antenne (usa anche `sampling.css` per layout e controlli)
- `assets/js/`
  - `sky.js` — sfondo a costellazioni (tutte le pagine)
  - `nav.js` — menu a schermo intero su mobile (tutte le pagine)
  - `cards.js` — riflesso delle card in home
  - `article.js` — indice, ancore, barra di lettura, copia del codice
  - `math-canvas.js` — logica del Math Canvas
  - `sampling.js` — Laboratorio di campionamento: segnali, spettri, ricostruzione, DFT/IFFT
  - `npz.js` — lettura e scrittura di file `.npz` di NumPy nel browser (zip/zip64 + `.npy`, nessuna dipendenza)
  - `antenne.js` — Laboratorio antenne: Friis, metriche, audit, confronto, lobo 3D; grafici con Plotly (CDN)
  - `pacchetto.js` — Laboratorio antenne, sezione Impacchetta: dai file grezzi del VNA (CSV/S2P per angolo) al pacchetto `.npz` standard v1 (`meta` JSON con nome, distanza, note, acquisizione, SHA-256 dei grezzi)

### Nuovo articolo

Copiare un articolo esistente in `articles/` e mantenere in `<head>`:

```html
<link rel="stylesheet" href="../assets/css/base.css">
<link rel="stylesheet" href="../assets/css/article.css">
<!-- solo se servono gli schemi -->
<link rel="stylesheet" href="../assets/css/diagrams.css">
```

e in fondo al `<body>`:

```html
<script src="../assets/js/sky.js" defer></script>
<script src="../assets/js/nav.js" defer></script>
<script src="../assets/js/article.js" defer></script>
```

### Flag IA

Le pagine il cui testo è stato scritto dall'IA (sui miei contenuti) mostrano questo badge:

```html
<p class="ai-flag">Testo scritto dall'IA sui miei contenuti, non ancora riscritto da me</p>
```

Quando riscrivo il testo di una pagina elimino quella riga (e il commento sopra). Per vedere quali pagine sono ancora da riscrivere:

```bash
grep -l 'class="ai-flag"' *.html articles/*.html
```

Sito statico, nessuna dipendenza di build. Unica libreria esterna: Plotly da cdnjs, solo nel Laboratorio antenne.

## Contatti

- **GitHub**: [@sergabbro](https://github.com/sergabbro)
- **Email**: sergabbro@gmail.com

## Licenza

- Codice: [MIT](LICENSE)
- Contenuti: [CC BY 4.0](LICENSE-CONTENT)
