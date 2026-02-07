import React, { useEffect, useState } from "react";

/**
 * Medieval archivist greetings — randomised commentary referencing the active note.
 * {note} is replaced with the note's basename (no extension).
 * Generic fallbacks are used when no note is active.
 */
const GREETINGS_WITH_NOTE: string[] = [
  'The tome "{note}" lies open upon the lectern, my liege.',
  'Ah, "{note}" \u2014 a most curious manuscript. Shall we dissect it?',
  'The scribes whisper of "{note}". What knowledge do you seek within?',
  'I\'ve dusted off "{note}" from the archive shelves. Ready when you are.',
  '"{note}" \u2014 last catalogued by the seventh keeper. How may I assist?',
  'The candles flicker over "{note}". What secrets shall we uncover?',
  'By the old quill, "{note}" awaits your command, my King.',
  'The vellum of "{note}" is spread before us. Speak your will.',
  '"{note}" has been retrieved from the deepest stacks. Proceed?',
  'A fine folio, this "{note}". The archives are at your disposal.',
  'The ink on "{note}" is still fresh. What shall we chronicle next?',
  '"{note}" \u2014 an entry worthy of the royal collection. Your orders?',
  'The binding of "{note}" creaks with age. Let us explore its wisdom.',
  'I\'ve cross-referenced "{note}" against the index. Awaiting instruction.',
  'The marginal notes on "{note}" are\u2026 intriguing. Shall I elaborate?',
];

const GREETINGS_GENERIC: string[] = [
  "The Archives stand ready, my King.",
  "The grand library awaits your command.",
  "No scroll is beyond our reach. What do you seek?",
  "The quills are sharpened. Speak, and I shall record.",
  "All tomes accounted for. How may I serve?",
  "The archive halls echo in silence. What knowledge do you require?",
  "Every parchment is in its place. Your orders, sire?",
  "The catalogues are current. What shall we investigate?",
  "Standing vigil over the stacks. Ready for your inquiry.",
  "The lectern is clear and the ink pot full. Command me.",
];

/**
 * Pick a random item from an array, avoiding the previous pick when possible.
 */
function pickRandom<T>(arr: T[], previous?: T): T {
  if (arr.length <= 1) return arr[0];
  let pick: T;
  do {
    pick = arr[Math.floor(Math.random() * arr.length)];
  } while (pick === previous && arr.length > 1);
  return pick;
}

/**
 * Compact greeting banner with Hendrik icon and randomised medieval archivist text.
 * Re-rolls the greeting each time the active note changes.
 */
export function ArchivistGreeting() {
  const [activeFileName, setActiveFileName] = useState<string | null>(null);
  const [greeting, setGreeting] = useState("");

  // Listen for active-file changes
  useEffect(() => {
    const update = () => {
      const file = app.workspace.getActiveFile();
      setActiveFileName(file ? file.basename : null);
    };

    update(); // initial

    const ref = app.workspace.on("active-leaf-change", update);
    return () => {
      app.workspace.offref(ref);
    };
  }, []);

  // Re-roll greeting whenever the active file changes
  useEffect(() => {
    if (activeFileName) {
      const template = pickRandom(GREETINGS_WITH_NOTE);
      setGreeting(template.replace("{note}", activeFileName));
    } else {
      setGreeting(pickRandom(GREETINGS_GENERIC));
    }
  }, [activeFileName]);

  return (
    <div className="copilot-archivist-greeting">
      <div className="copilot-archivist-greeting__avatar" aria-hidden="true" />
      <span className="copilot-archivist-greeting__text">{greeting}</span>
    </div>
  );
}
