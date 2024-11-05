/*

Behringer Cmd Studio 2A controls diagram:
https://github.com/mixxxdj/mixxx/wiki/Behringer-Cmd-Studio-2A

List of Mixxx controls: 
https://manual.mixxx.org/2.3/en/chapters/appendix/mixxx_controls

Scripting tutorial:
https://github.com/mixxxdj/mixxx/wiki/midi-scripting

*/

const DIRECTION_FORWARD = 1;
const DIRECTION_BACKWARD = 0;

const FAST_BLINK_RATE = 150;
const SLOW_BLINK_RATE = 400;

const BUTTON_PRESSED = 0x90;
const BUTTON_RELEASED = 0x80;

// Master buttons
const BTN_VINYL = 0x22;
const BTN_MODE = 0x23;

const BTN_FOLDER = 0x25;
const BTN_FILE = 0x26;

// Deck specific buttons
const BTN_LEFT_CUE = 0x01;
const BTN_LEFT_PLAY = 0x02;
const BTN_LEFT_ASSIGN_A = 0x08;
const BTN_LEFT_ASSIGN_B = 0x09;
const BTN_LEFT_PFL = 0x16;

const BTN_RIGHT_CUE = 0x31;
const BTN_RIGHT_PLAY = 0x32;
const BTN_RIGHT_ASSIGN_A = 0x38;
const BTN_RIGHT_ASSIGN_B = 0x39;
const BTN_RIGHT_PFL = 0x46;

function B2A() {}

// Called when the MIDI device is opened & set up
B2A.init = function (id) {
  B2A.engine = engine;

  // Lights play/cue buttons
  B2A.lightOn(BTN_LEFT_CUE);
  B2A.lightOn(BTN_LEFT_PLAY);
  B2A.lightOn(BTN_RIGHT_CUE);
  B2A.lightOn(BTN_RIGHT_PLAY);

  // Turns the mode buttons off
  B2A.lightOff(BTN_VINYL);
  B2A.lightOff(BTN_MODE);

  // Turn the file and folder button on
  B2A.lightOn(BTN_FOLDER);
  B2A.lightOn(BTN_FILE);

  // Assign A on deck 1 and 2
  B2A.lightOn(BTN_LEFT_ASSIGN_A);
  B2A.lightOff(BTN_LEFT_ASSIGN_B);
  B2A.lightOn(BTN_RIGHT_ASSIGN_A);
  B2A.lightOff(BTN_RIGHT_ASSIGN_B);

  // Turns the Headphone cues button lights off
  B2A.lightOff(BTN_LEFT_PFL);
  B2A.lightOff(BTN_RIGHT_PFL);

  // No mix in headphones
  B2A.engine.setParameter("[Master]", "headMix", -1);
  B2A.engine.setParameter("[Master]", "headGain", 0.05);

  B2A.engine.setValue("[Channel1]", "quantize", 0);
  B2A.engine.setValue("[Channel2]", "quantize", 0);
  B2A.engine.setValue("[Channel1]", "volume", 0);
  B2A.engine.setValue("[Channel2]", "volume", 0);
  B2A.engine.setValue("[Channel1]", "play", 0);
  B2A.engine.setValue("[Channel2]", "play", 0);
  B2A.engine.setValue("[Channel1]", "pfl", 0);
  B2A.engine.setValue("[Channel2]", "pfl", 0);

  // Hide racks of effects and show samples
  B2A.engine.setValue("[EffectRack1]", "show", 0);
  B2A.engine.setParameter(`[QuickEffectRack1_[Channel1]_Effect1]`, "clear", 1);
  B2A.engine.setParameter(`[QuickEffectRack1_[Channel2]_Effect1]`, "clear", 1);
  B2A.engine.setParameter(`[QuickEffectRack1_[Channel1]]`, "enabled", 0);
  B2A.engine.setParameter(`[QuickEffectRack1_[Channel2]]`, "enabled", 0);
  B2A.engine.setParameter(
    `[QuickEffectRack1_[Channel1]]`,
    "super1_set_default",
    1
  );
  B2A.engine.setParameter(
    `[QuickEffectRack1_[Channel2]]`,
    "super1_set_default",
    1
  );

  B2A.engine.setValue("[Samplers]", "show_samplers", 1);

  // Vars and state
  B2A.vinylMode = false;
  B2A.mode = false;
  B2A.deckState = [
    {}, // 0-index is not used
    {
      // Deck 1
      scratchTimer: -1,
      loopMode: true,
    },
    {
      // Deck 2
      scratchTimer: -1,
      loopMode: true,
    },
  ];
  B2A.blinks = {};
};

/******************************************************/
/*                       UTILITIES                    */
/******************************************************/

B2A.lightOn = function (control) {
  midi.sendShortMsg(0x90, control, 0x01);
};

B2A.lightOff = function (control) {
  midi.sendShortMsg(0x90, control, 0x00);
};

B2A.toggleLight = function (control, value) {
  midi.sendShortMsg(0x90, control, value === true ? 0x01 : 0x00);
};

B2A.blink = function (control, speed) {
  if (!Object.keys(B2A.blinks).includes(`b${control}`)) {
    B2A.blinks[`b${control}`] = { timer: -1, state: true };
  }
  engine.stopTimer(B2A.blinks[`b${control}`].timer);
  B2A.blinks[`b${control}`].timer = engine.beginTimer(speed, () =>
    B2A.toggleBlink(control)
  );
};

B2A.toggleBlink = function (control) {
  B2A.blinks[`b${control}`].state = !B2A.blinks[`b${control}`].state;
  B2A.toggleLight(control, B2A.blinks[`b${control}`].state);
};

B2A.stopBlinking = function (control) {
  engine.stopTimer(B2A.blinks[`b${control}`].timer);
};

B2A.isPlaying = function (group) {
  return !!engine.getValue(group, "play");
};

B2A.groupToDeck = function (group) {
  switch (group) {
    case "[Channel1]":
      return 1;
    case "[Channel2]":
      return 2;
    default:
      return 1; // 1 by default, should not happen
  }
};

/******************************************************/
/*                     MODES BUTTONS                  */
/******************************************************/

// Switch between jog (or not) and scratch
// when vinylMode = true, we can job during live playback with the jog wheel
B2A.vinylButton = function (channel, control, value, status, group) {
  B2A.vinylMode = !B2A.vinylMode;
  B2A.toggleLight(BTN_VINYL, !!B2A.vinylMode);
};

// Switch between folder navigation and pitch
// when mode = true, the pitch knob is used to control pitch. When false
// it's used to navigate in folders
B2A.modeButton = function (channel, control, value, status, group) {
  B2A.mode = !B2A.mode;
  B2A.toggleLight(BTN_MODE, B2A.mode);
};

/******************************************************/
/*               FILTERS, LOOPS AND SAMPLES           */
/******************************************************/

// Cue: either loops or filters
B2A.assignChannel = function (channel, control, value, status, group) {
  const deck = B2A.groupToDeck(group);

  switch (control) {
    case BTN_LEFT_ASSIGN_A:
      // Deck 1 — Assign A
      B2A.lightOff(BTN_LEFT_ASSIGN_B);
      B2A.deckState[deck].loopMode = true;
      break;
    case BTN_LEFT_ASSIGN_B:
      // Deck 1 — Assign B -> filters
      B2A.lightOff(BTN_LEFT_ASSIGN_A);
      B2A.deckState[deck].loopMode = false;
      break;
    case BTN_RIGHT_ASSIGN_A:
      // Deck 2 — Assign A
      B2A.lightOff(BTN_RIGHT_ASSIGN_B);
      B2A.deckState[deck].loopMode = true;
      break;
    case BTN_RIGHT_ASSIGN_B:
      // Deck 2 — Assign B -> filters
      B2A.lightOff(BTN_RIGHT_ASSIGN_A);
      B2A.deckState[deck].loopMode = false;
      break;
  }

  B2A.lightOn(control);

  if (B2A.deckState[deck].loopMode === false) {
    B2A.blink(
      deck === 1 ? BTN_LEFT_ASSIGN_B : BTN_RIGHT_ASSIGN_B,
      SLOW_BLINK_RATE
    );
  } else {
    B2A.stopBlinking(deck === 1 ? BTN_LEFT_ASSIGN_B : BTN_RIGHT_ASSIGN_B);
  }
};

B2A.cueButton = function (channel, control, value, status, group) {
  if (status !== BUTTON_PRESSED) {
    // Ignore when the button is released
    return;
  }

  const deck = B2A.groupToDeck(group);

  if (B2A.deckState[deck].loopMode) {
    // Add loops
    switch (control) {
      case 0x0a:
      case 0x3a:
        // Button "1" - halve the duration
        engine.setParameter(group, "loop_halve", 1);
        break;
      case 0x0b:
      case 0x3b:
        // Button "2" - double the duration
        engine.setParameter(group, "loop_double", 1);
        break;
      case 0x0c:
      case 0x3c:
        // Button "3" - we activate, 4 beats by default
        engine.setParameter(group, "quantize", 1);
        engine.setParameter(group, "beatloop_4_toggle", 1);
        engine.setParameter(group, "quantize", 0);
        break;
      case 0x0d:
      case 0x3d:
        // Button "4" — exit the loop
        engine.setParameter(group, "reloop_toggle", 1);
        break;
    }
  } else {
    // Enable/disable filters
    var effect = null;
    switch (control) {
      case 0x0a:
      case 0x3a:
        // Button "1" - prev effect
        engine.setParameter(
          `[QuickEffectRack1_${group}]`,
          "chain_selector",
          -1
        );
        break;
      case 0x0b:
      case 0x3b:
        // Button "2" - next effect
        engine.setParameter(`[QuickEffectRack1_${group}]`, "chain_selector", 1);
        break;
      case 0x0c:
      case 0x3c:
        // Button "3" - toggle enable/disable the quick filter
        const active = engine.getParameter(
          `[QuickEffectRack1_${group}]`,
          "enabled"
        );

        if (!active) {
          // Trick to reenable the filter correctly when enabling
          engine.setParameter(
            `[QuickEffectRack1_${group}]`,
            "chain_selector",
            1
          );
          engine.setParameter(
            `[QuickEffectRack1_${group}]`,
            "chain_selector",
            -1
          );
          // We also set the button to blink faster
          B2A.blink(
            deck === 1 ? BTN_LEFT_ASSIGN_B : BTN_RIGHT_ASSIGN_B,
            FAST_BLINK_RATE
          );
        } else {
          // We also set the button to blink slower
          B2A.blink(
            deck === 1 ? BTN_LEFT_ASSIGN_B : BTN_RIGHT_ASSIGN_B,
            SLOW_BLINK_RATE
          );
        }

        engine.setParameter(
          `[QuickEffectRack1_${group}]`,
          "enabled",
          active ? 0 : 1
        );
        break;
      case 0x0d:
      case 0x3d:
        // Button "4" - reset to default
        engine.setParameter(`[QuickEffectRack1_${group}]`, "enabled", 0);
        engine.setParameter(
          `[QuickEffectRack1_${group}]`,
          "super1_set_default",
          1
        );
        B2A.blink(
          deck === 1 ? BTN_LEFT_ASSIGN_B : BTN_RIGHT_ASSIGN_B,
          SLOW_BLINK_RATE
        );
        break;
    }
  }
};

B2A.sampleButton = function (channel, control, value, status, group) {
  if (status !== BUTTON_PRESSED) {
    // Ignore when the button is released
    return;
  }

  var sampler = null;

  switch (control) {
    case 0x0e:
    case 0x3e:
      sampler = 1;
      break;
    case 0x0f:
    case 0x3f:
      sampler = 2;
      break;
    case 0x11:
    case 0x41:
      sampler = 3;
      break;
    case 0x12:
    case 0x42:
      sampler = 4;
      break;
  }

  const samplerGroup = `[Sampler${sampler}]`;
  const samplePlaying = engine.getParameter(samplerGroup, "play");
  // Reset the sample to the start, and plays/pauses as needed
  engine.setParameter(samplerGroup, "playposition", 0);
  engine.setParameter(samplerGroup, "play", samplePlaying ? 0 : 1);
};

/******************************************************/
/*                  PITCH KNOB AND BUTTONS            */
/******************************************************/

B2A.scrubPlayhead = function (group, status, direction) {
  const offset = direction === DIRECTION_FORWARD ? 0.001 : -0.001;
  const playhead = engine.getValue(group, "playposition");
  engine.setValue(group, "playposition", playhead + offset);
};

B2A.pitchBendUp = function (channel, control, value, status, group) {
  if (B2A.isPlaying(group)) {
    engine.setValue(group, "rate_temp_up", status === BUTTON_PRESSED ? 1 : 0);
  } else {
    B2A.scrubPlayhead(group, status, DIRECTION_FORWARD);
  }
};

B2A.pitchBendDown = function (channel, control, value, status, group) {
  if (B2A.isPlaying(group)) {
    engine.setValue(group, "rate_temp_down", status === BUTTON_PRESSED ? 1 : 0);
  } else {
    B2A.scrubPlayhead(group, status, DIRECTION_BACKWARD);
  }
};

B2A.pitchKnob = function (channel, control, value, status, group) {
  if (value === 63) {
    value = -1;
  } else {
    value = 1;
  }

  const deck = B2A.groupToDeck(group);

  if (!B2A.deckState[deck].loopMode) {
    // In filters mode, we use the knob to modify the filter mix
    if (value === 1) {
      engine.setValue(`[QuickEffectRack1_${group}]`, "super1_up_small", 1);
      engine.setValue(`[QuickEffectRack1_${group}]`, "super1_up_small", 0);
    } else {
      engine.setValue(`[QuickEffectRack1_${group}]`, "super1_down_small", 1);
      engine.setValue(`[QuickEffectRack1_${group}]`, "super1_down_small", 0);
    }
  } else if (B2A.mode) {
    // Changing the pitch for the relevant deck
    if (value === 1) {
      engine.setValue(group, "rate_perm_up_small", 1);
      engine.setValue(group, "rate_perm_up_small", 0);
    } else {
      engine.setValue(group, "rate_perm_down_small", 1);
      engine.setValue(group, "rate_perm_down_small", 0);
    }
  } else {
    // Navigating the folders
    engine.setValue("[Playlist]", "SelectTrackKnob", value);
  }
};

/******************************************************/
/*                      SYNC BUTTON                   */
/******************************************************/

B2A.sync = function (channel, control, value, status, group) {
  engine.setValue(group, "beats_translate_curpos", 1);
  engine.setValue(group, "beats_translate_curpos", 0);
  engine.setValue(group, "beatsync", 1);
  engine.setValue(group, "beatsync", 0);
};

/******************************************************/
/*                    HEADPHONE CUE                   */
/******************************************************/

B2A.pfl = function (channel, control, value, status, group) {
  const pfl = engine.getValue(group, "pfl");
  engine.setValue(group, "pfl", !pfl);

  // Toggles the button light
  B2A.toggleLight(control, !pfl);
};

/******************************************************/
/*                        JOGWHEEL                    */
/******************************************************/

B2A.jogWheelStopScratch = function (deck) {
  B2A.deckState[deck].scratchTimer = -1;
  engine.scratchDisable(deck);
};

B2A.jogWheel = function (channel, control, value, status, group) {
  const deck = B2A.groupToDeck(group);

  // in B2A.vinylMode, we allow to scratch:
  // - if the deck is not playing
  // - if the deck is playing and B2A.vinylMode or the volume is 0
  const allowed =
    !B2A.isPlaying(group) ||
    (B2A.isPlaying(group) &&
      (B2A.vinylMode || engine.getValue(group, "volume") === 0));

  if (!allowed) {
    return;
  }

  var adjustedJog = value > 64 ? 1 : -1;

  if (B2A.isPlaying(group)) {
    const gammaInputRange = 5; // Max jog speed
    const maxOutFraction = 0.5; // Where on the curve it should peak; 0.5 is half-way
    const gammaOutputRange = 5; // Max rate change

    adjustedJog =
      (gammaOutputRange * adjustedJog) / (gammaInputRange * maxOutFraction);
  }

  if (B2A.deckState[deck].scratchTimer == -1) {
    engine.scratchEnable(deck, 128, 33 + 1 / 3, 1.0 / 8, 1.0 / 8 / 32);
  } else {
    engine.stopTimer(B2A.deckState[deck].scratchTimer);
  }
  engine.scratchTick(deck, adjustedJog);
  B2A.deckState[deck].scratchTimer = engine.beginTimer(
    20,
    () => B2A.jogWheelStopScratch(deck),
    true
  );
};
