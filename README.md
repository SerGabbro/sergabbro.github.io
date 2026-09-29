# Gabbro

Note tecniche di un ingegnere elettronico: reti, sicurezza dei sistemi, Linux, elettronica e strumenti interattivi.

🌐 [sergabbro.github.io](https://sergabbro.github.io)

## Struttura

- `index.html` — home
- `articles/` — articoli
- `tools/` — strumenti interattivi (Math Canvas)
- `assets/css/`
  - `base.css` — token, reset, navbar, footer, elementi comuni (tutte le pagine)
  - `home.css` — hero, card, "Chi sono"
  - `article.css` — layout e tipografia degli articoli, codice, callout, tabelle, indice
  - `diagrams.css` — schemi HTML/CSS usati negli articoli
  - `math-canvas.css` — stile dello strumento Math Canvas
- `assets/js/`
  - `sky.js` — sfondo a costellazioni (tutte le pagine)
  - `cards.js` — riflesso delle card in home
  - `article.js` — indice, ancore, barra di lettura, copia del codice
  - `math-canvas.js` — logica del Math Canvas

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
<script src="../assets/js/article.js" defer></script>
```

Sito statico, nessuna dipendenza di build.

## Contatti

- **GitHub**: [@sergabbro](https://github.com/sergabbro)
- **Email**: sergabbro@gmail.com

## Licenza

- Codice: [MIT](LICENSE)
- Contenuti: [CC BY 4.0](LICENSE-CONTENT)
