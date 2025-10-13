// script.js - gestione pulsanti e animazioni
document.addEventListener("DOMContentLoaded", () => {
  // alert basic sui bottoni
  const buttons = document.querySelectorAll(".btn");
  buttons.forEach(btn => {
    btn.addEventListener("click", (e) => {
      // se il link è un <a>, lascia navigare; per button mostra alert
      if (btn.tagName.toLowerCase() === "button") {
        alert(`Hai cliccato: ${btn.textContent}`);
      }
    });
  });

  // Animazione sequenziale delle cards
  const cards = document.querySelectorAll(".card");
  cards.forEach((card, index) => {
    setTimeout(() => {
      card.classList.add("fade-in");
    }, index * 150);
  });

  // Language switch (se presente in pagina dell'articolo)
  const langSwitch = document.getElementById("langSwitch");
  if (langSwitch) {
    const itBlocks = document.querySelectorAll(".lang.it");
    const enBlocks = document.querySelectorAll(".lang.en");
    // carica preferenza
    let current = localStorage.getItem("siteLang") || "it";
    const setLang = (lang) => {
      if (lang === "it") {
        itBlocks.forEach(n => n.classList.remove("hidden"));
        enBlocks.forEach(n => n.classList.add("hidden"));
        langSwitch.querySelector("img").src = langSwitch.dataset.it;
        localStorage.setItem("siteLang", "it");
      } else {
        enBlocks.forEach(n => n.classList.remove("hidden"));
        itBlocks.forEach(n => n.classList.add("hidden"));
        langSwitch.querySelector("img").src = langSwitch.dataset.en;
        localStorage.setItem("siteLang", "en");
      }
    };
    // inizializza
    setLang(current);

    langSwitch.addEventListener("click", () => {
      current = (current === "it") ? "en" : "it";
      setLang(current);
      // effetto di transizione (fade)
      const container = document.querySelector(".container");
      if (container) {
        container.style.opacity = 0.8;
        setTimeout(() => container.style.opacity = 1, 150);
      }
    });
  }
});
