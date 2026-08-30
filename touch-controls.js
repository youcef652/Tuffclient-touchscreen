/* ===================================================================
   Eaglercraft Touch Controls - Custom Button Layout (PojavLauncher-style)
   ---------------------------------------------------------------------
   Adds a customizable on-screen touch control overlay on top of the
   EaglercraftX WASM game: a movement joystick, action buttons, and a
   camera-look drag area. Buttons can be dragged/resized/added/removed
   in an in-game "edit mode", and the layout is saved to localStorage.

   This does NOT modify the compiled game (assets.epw / WASM). Instead
   it sits above the canvas and synthesizes keyboard/mouse events that
   the game already listens for, exactly like a software gamepad.
   =================================================================== */

(function () {
	"use strict";

	var STORAGE_KEY = "eagler_touch_layout_v1";

	// ---- Palette of all bindable actions (vanilla Minecraft 1.12 defaults) ----
	var ACTIONS = {
		forward:  { label: "W",     key: "KeyW",        type: "hold" },
		back:     { label: "S",     key: "KeyS",        type: "hold" },
		left:     { label: "A",     key: "KeyA",        type: "hold" },
		right:    { label: "D",     key: "KeyD",        type: "hold" },
		jump:     { label: "Jump",  key: "Space",       type: "hold" },
		sneak:    { label: "Sneak", key: "ShiftLeft",   type: "hold" },
		sprint:   { label: "Sprint",key: "ControlLeft", type: "hold" },
		inventory:{ label: "Inv",   key: "KeyE",        type: "tap"  },
		drop:     { label: "Drop",  key: "KeyQ",        type: "tap"  },
		chat:     { label: "Chat",  key: "Enter",       type: "tap"  },
		swap:     { label: "Swap",  key: "KeyF",         type: "tap"  },
		attack:   { label: "Hit",   mouse: 0,           type: "hold" },
		use:      { label: "Use",   mouse: 2,           type: "hold" },
		hb1: { label: "1", key: "Digit1", type: "tap" },
		hb2: { label: "2", key: "Digit2", type: "tap" },
		hb3: { label: "3", key: "Digit3", type: "tap" },
		hb4: { label: "4", key: "Digit4", type: "tap" },
		hb5: { label: "5", key: "Digit5", type: "tap" },
		hb6: { label: "6", key: "Digit6", type: "tap" },
		hb7: { label: "7", key: "Digit7", type: "tap" },
		hb8: { label: "8", key: "Digit8", type: "tap" },
		hb9: { label: "9", key: "Digit9", type: "tap" }
	};

	// Default layout, in percent of viewport width/height (top-left anchored).
	// type "joystick" is special-cased.
	function defaultLayout() {
		return [
			{ id: "move", widget: "joystick", x: 3, y: 62, w: 26, action: null },
			{ id: "jump", widget: "button", x: 82, y: 60, w: 13, action: "jump", round: true },
			{ id: "sneak", widget: "button", x: 82, y: 78, w: 13, action: "sneak", round: true },
			{ id: "attack", widget: "button", x: 66, y: 68, w: 12, action: "attack", round: true },
			{ id: "use", widget: "button", x: 66, y: 84, w: 12, action: "use", round: true },
			{ id: "inv", widget: "button", x: 89, y: 20, w: 9, action: "inventory", round: false },
			{ id: "drop", widget: "button", x: 89, y: 33, w: 9, action: "drop", round: false },
			{ id: "chat", widget: "button", x: 89, y: 46, w: 9, action: "chat", round: false }
		];
	}

	function loadLayout() {
		try {
			var raw = localStorage.getItem(STORAGE_KEY);
			if (raw) {
				var parsed = JSON.parse(raw);
				if (Array.isArray(parsed) && parsed.length) return parsed;
			}
		} catch (e) {}
		return defaultLayout();
	}

	function saveLayout(layout) {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
		} catch (e) {}
	}

	function isTouchDevice() {
		return ("ontouchstart" in window) || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0);
	}

	// ---------------------------------------------------------------
	// Event dispatch helpers - synthesize input the game already reads
	// ---------------------------------------------------------------
	var keyState = {}; // key -> held boolean (ref count not needed, actions are per-id)

	function fireKey(code, down) {
		var type = down ? "keydown" : "keyup";
		var ev;
		try {
			ev = new KeyboardEvent(type, {
				code: code,
				key: codeToKey(code),
				keyCode: codeToKeyCode(code),
				which: codeToKeyCode(code),
				bubbles: true,
				cancelable: true
			});
		} catch (e) { return; }
		// Some engines read keyCode/which as own properties (constructor may ignore them
		// in some browsers), so force-define them just in case.
		try {
			Object.defineProperty(ev, "keyCode", { get: function () { return codeToKeyCode(code); } });
			Object.defineProperty(ev, "which", { get: function () { return codeToKeyCode(code); } });
		} catch (e) {}
		document.dispatchEvent(ev);
		var canvas = getCanvas();
		if (canvas) canvas.dispatchEvent(ev);
	}

	function fireMouseButton(button, down) {
		var canvas = getCanvas();
		if (!canvas) return;
		var type = down ? "mousedown" : "mouseup";
		var rect = canvas.getBoundingClientRect();
		var ev = new MouseEvent(type, {
			button: button,
			buttons: down ? (1 << button) : 0,
			clientX: rect.left + rect.width / 2,
			clientY: rect.top + rect.height / 2,
			bubbles: true,
			cancelable: true
		});
		canvas.dispatchEvent(ev);
	}

	function fireMouseMove(dx, dy) {
		var canvas = getCanvas();
		if (!canvas) return;
		var rect = canvas.getBoundingClientRect();
		var ev;
		try {
			ev = new MouseEvent("mousemove", {
				movementX: dx,
				movementY: dy,
				clientX: rect.left + rect.width / 2,
				clientY: rect.top + rect.height / 2,
				bubbles: true,
				cancelable: true
			});
		} catch (e) { return; }
		try {
			Object.defineProperty(ev, "movementX", { get: function () { return dx; } });
			Object.defineProperty(ev, "movementY", { get: function () { return dy; } });
		} catch (e) {}
		canvas.dispatchEvent(ev);
		document.dispatchEvent(ev);
	}

	// Rough code -> key / keyCode maps for legacy listeners
	var KEYCODE_MAP = {
		KeyW: 87, KeyA: 65, KeyS: 83, KeyD: 68, KeyE: 69, KeyQ: 81, KeyF: 70,
		Space: 32, ShiftLeft: 16, ControlLeft: 17, Enter: 13,
		Digit1: 49, Digit2: 50, Digit3: 51, Digit4: 52, Digit5: 53,
		Digit6: 54, Digit7: 55, Digit8: 56, Digit9: 57
	};
	function codeToKeyCode(code) { return KEYCODE_MAP[code] || 0; }
	function codeToKey(code) {
		if (code === "Space") return " ";
		if (code.indexOf("Digit") === 0) return code.substring(5);
		if (code === "ShiftLeft") return "Shift";
		if (code === "ControlLeft") return "Control";
		if (code === "Enter") return "Enter";
		if (code.indexOf("Key") === 0) return code.substring(3).toLowerCase();
		return code;
	}

	function getCanvas() {
		var container = document.getElementById(
			(window.eaglercraftXOpts && window.eaglercraftXOpts.container) || "game_frame"
		);
		if (!container) return document.querySelector("canvas");
		return container.querySelector("canvas") || document.querySelector("canvas");
	}

	function pressAction(actionId, down) {
		var action = ACTIONS[actionId];
		if (!action) return;
		if (action.key) fireKey(action.key, down);
		if (typeof action.mouse === "number") fireMouseButton(action.mouse, down);
	}

	// ---------------------------------------------------------------
	// Build overlay DOM
	// ---------------------------------------------------------------
	var overlay, lookLayer, toolbar, palette;
	var layout = loadLayout();
	var editing = false;
	var visible = true;

	function vw(pct) { return window.innerWidth * (pct / 100); }
	function vh(pct) { return window.innerHeight * (pct / 100); }

	function buildOverlay() {
		overlay = document.createElement("div");
		overlay.id = "etcOverlay";

		lookLayer = document.createElement("div");
		lookLayer.id = "etcLookLayer";
		overlay.appendChild(lookLayer);

		toolbar = document.createElement("div");
		toolbar.id = "etcToolbar";
		toolbar.innerHTML =
			'<div class="etc-tool-btn" id="etcEditToggle" title="Edit layout">&#9881;</div>' +
			'<div class="etc-tool-btn" id="etcAddToggle" title="Add button">+</div>' +
			'<div class="etc-tool-btn" id="etcResetBtn" title="Reset layout">&#8635;</div>' +
			'<div class="etc-tool-btn" id="etcHideBtn" title="Hide controls">&#128065;</div>';
		overlay.appendChild(toolbar);

		palette = document.createElement("div");
		palette.id = "etcPalette";
		overlay.appendChild(palette);

		document.body.appendChild(overlay);

		document.getElementById("etcEditToggle").addEventListener("pointerdown", function (e) {
			e.stopPropagation();
			setEditing(!editing);
		});
		document.getElementById("etcAddToggle").addEventListener("pointerdown", function (e) {
			e.stopPropagation();
			togglePalette();
		});
		document.getElementById("etcResetBtn").addEventListener("pointerdown", function (e) {
			e.stopPropagation();
			if (confirm("Reset button layout to default?")) {
				layout = defaultLayout();
				saveLayout(layout);
				renderButtons();
			}
		});
		document.getElementById("etcHideBtn").addEventListener("pointerdown", function (e) {
			e.stopPropagation();
			visible = !visible;
			overlay.classList.toggle("etc-hidden", !visible);
		});

		renderButtons();
		attachLookLayer();
	}

	function togglePalette() {
		var used = {};
		layout.forEach(function (b) { if (b.action) used[b.action] = true; });
		palette.innerHTML = "";
		Object.keys(ACTIONS).forEach(function (id) {
			if (used[id]) return;
			var item = document.createElement("div");
			item.className = "etc-palette-item";
			item.textContent = ACTIONS[id].label + " (" + id + ")";
			item.addEventListener("pointerdown", function (e) {
				e.stopPropagation();
				layout.push({ id: "b_" + id + "_" + Date.now(), widget: "button", x: 40, y: 40, w: 10, action: id, round: false });
				saveLayout(layout);
				renderButtons();
				palette.classList.remove("etc-open");
			});
			palette.appendChild(item);
		});
		palette.classList.toggle("etc-open");
	}

	function setEditing(v) {
		editing = v;
		overlay.classList.toggle("etc-editing", editing);
		document.getElementById("etcEditToggle").classList.toggle("etc-tool-active", editing);
		if (!editing) palette.classList.remove("etc-open");
	}

	// ---------------------------------------------------------------
	// Render buttons / joystick from `layout`
	// ---------------------------------------------------------------
	var widgetEls = {};

	function renderButtons() {
		Object.keys(widgetEls).forEach(function (id) {
			widgetEls[id].el.remove();
		});
		widgetEls = {};

		layout.forEach(function (item) {
			if (item.widget === "joystick") {
				buildJoystick(item);
			} else {
				buildButton(item);
			}
		});
	}

	function applyPos(el, item) {
		el.style.left = vw(item.x) + "px";
		el.style.top = vh(item.y) + "px";
		var size = vw(item.w);
		el.style.width = size + "px";
		el.style.height = size + "px";
	}

	function addDragAndResize(el, item, onMoveExtra) {
		var dragging = false, startX, startY, origX, origY;

		el.addEventListener("pointerdown", function (e) {
			if (!editing) return;
			e.stopPropagation();
			e.preventDefault();
			dragging = true;
			startX = e.clientX; startY = e.clientY;
			origX = item.x; origY = item.y;
			el.setPointerCapture(e.pointerId);
		});
		el.addEventListener("pointermove", function (e) {
			if (!dragging) return;
			e.stopPropagation();
			var dxPct = ((e.clientX - startX) / window.innerWidth) * 100;
			var dyPct = ((e.clientY - startY) / window.innerHeight) * 100;
			item.x = Math.max(0, Math.min(96, origX + dxPct));
			item.y = Math.max(0, Math.min(96, origY + dyPct));
			applyPos(el, item);
		});
		function endDrag(e) {
			if (!dragging) return;
			dragging = false;
			saveLayout(layout);
		}
		el.addEventListener("pointerup", endDrag);
		el.addEventListener("pointercancel", endDrag);

		// resize handle
		var rh = document.createElement("div");
		rh.className = "etc-resize-handle";
		el.appendChild(rh);
		var resizing = false, rStartX, rOrigW;
		rh.addEventListener("pointerdown", function (e) {
			if (!editing) return;
			e.stopPropagation();
			e.preventDefault();
			resizing = true;
			rStartX = e.clientX;
			rOrigW = item.w;
			rh.setPointerCapture(e.pointerId);
		});
		rh.addEventListener("pointermove", function (e) {
			if (!resizing) return;
			e.stopPropagation();
			var dPct = ((e.clientX - rStartX) / window.innerWidth) * 100;
			item.w = Math.max(5, Math.min(40, rOrigW + dPct));
			applyPos(el, item);
		});
		function endResize() {
			if (!resizing) return;
			resizing = false;
			saveLayout(layout);
		}
		rh.addEventListener("pointerup", endResize);
		rh.addEventListener("pointercancel", endResize);

		// delete handle (buttons only, not joystick base itself... joystick can be removed too)
		var del = document.createElement("div");
		del.className = "etc-del-handle";
		del.textContent = "\u2715";
		del.addEventListener("pointerdown", function (e) {
			e.stopPropagation();
			e.preventDefault();
			layout = layout.filter(function (l) { return l.id !== item.id; });
			saveLayout(layout);
			renderButtons();
		});
		el.appendChild(del);
	}

	function buildButton(item) {
		var el = document.createElement("div");
		el.className = "etc-btn" + (item.round ? " etc-round" : "");
		var action = ACTIONS[item.action];
		el.textContent = action ? action.label : "?";
		applyPos(el, item);
		overlay.appendChild(el);
		widgetEls[item.id] = { el: el, item: item };

		var pressed = false;
		el.addEventListener("pointerdown", function (e) {
			if (editing) return; // dragging handled separately when editing
			e.preventDefault();
			e.stopPropagation();
			pressed = true;
			el.classList.add("etc-active");
			el.setPointerCapture(e.pointerId);
			pressAction(item.action, true);
		});
		function release(e) {
			if (!pressed) return;
			pressed = false;
			el.classList.remove("etc-active");
			pressAction(item.action, false);
		}
		el.addEventListener("pointerup", release);
		el.addEventListener("pointercancel", release);
		el.addEventListener("pointerleave", function (e) {
			// keep held for touch-drag-off-button? Mimic mobile: releasing on leave is safer
			release(e);
		});

		addDragAndResize(el, item);
	}

	function buildJoystick(item) {
		var base = document.createElement("div");
		base.className = "etc-joystick-base";
		var knob = document.createElement("div");
		knob.className = "etc-joystick-knob";
		base.appendChild(knob);
		applyPos(base, item);
		overlay.appendChild(base);
		widgetEls[item.id] = { el: base, item: item };

		var active = false, centerX, centerY, radius;
		var heldKeys = { forward: false, back: false, left: false, right: false };

		function setHeld(dir, val) {
			if (heldKeys[dir] === val) return;
			heldKeys[dir] = val;
			pressAction(dir, val);
		}
		function releaseAll() {
			setHeld("forward", false);
			setHeld("back", false);
			setHeld("left", false);
			setHeld("right", false);
			knob.style.left = "29%";
			knob.style.top = "29%";
		}

		base.addEventListener("pointerdown", function (e) {
			if (editing) return;
			e.preventDefault();
			e.stopPropagation();
			active = true;
			var rect = base.getBoundingClientRect();
			centerX = rect.left + rect.width / 2;
			centerY = rect.top + rect.height / 2;
			radius = rect.width / 2;
			base.setPointerCapture(e.pointerId);
			updateStick(e.clientX, e.clientY);
		});
		base.addEventListener("pointermove", function (e) {
			if (!active || editing) return;
			e.preventDefault();
			updateStick(e.clientX, e.clientY);
		});
		function endStick(e) {
			if (!active) return;
			active = false;
			releaseAll();
		}
		base.addEventListener("pointerup", endStick);
		base.addEventListener("pointercancel", endStick);

		function updateStick(cx, cy) {
			var dx = cx - centerX, dy = cy - centerY;
			var dist = Math.min(radius, Math.sqrt(dx * dx + dy * dy));
			var angle = Math.atan2(dy, dx);
			var kx = Math.cos(angle) * dist, ky = Math.sin(angle) * dist;
			var pctX = 29 + (kx / radius) * 29;
			var pctY = 29 + (ky / radius) * 29;
			knob.style.left = pctX + "%";
			knob.style.top = pctY + "%";

			var deadzone = radius * 0.25;
			if (Math.sqrt(dx * dx + dy * dy) < deadzone) {
				setHeld("forward", false); setHeld("back", false);
				setHeld("left", false); setHeld("right", false);
				return;
			}
			var deg = angle * 180 / Math.PI; // -180..180, 0 = right, 90 = down
			setHeld("forward", deg > -135 && deg < -45);
			setHeld("back", deg > 45 && deg < 135);
			setHeld("left", deg > 135 || deg < -135);
			setHeld("right", deg > -45 && deg < 45);
		}

		addDragAndResize(base, item);
	}

	// ---------------------------------------------------------------
	// Look / camera drag layer
	// ---------------------------------------------------------------
	function attachLookLayer() {
		var lastX, lastY, active = false, pid = null;
		lookLayer.addEventListener("pointerdown", function (e) {
			if (editing) return;
			active = true;
			pid = e.pointerId;
			lastX = e.clientX;
			lastY = e.clientY;
			lookLayer.setPointerCapture(e.pointerId);
			// best-effort: try to enter pointer lock on the canvas so the game's
			// own mouse-look code (if it relies on pointer lock) engages too.
			var canvas = getCanvas();
			if (canvas && canvas.requestPointerLock && document.pointerLockElement !== canvas) {
				try { canvas.requestPointerLock(); } catch (err) {}
			}
		});
		lookLayer.addEventListener("pointermove", function (e) {
			if (!active || e.pointerId !== pid) return;
			var dx = e.clientX - lastX;
			var dy = e.clientY - lastY;
			lastX = e.clientX;
			lastY = e.clientY;
			if (dx || dy) fireMouseMove(dx, dy);
		});
		function endLook(e) {
			if (e.pointerId !== pid) return;
			active = false;
			pid = null;
		}
		lookLayer.addEventListener("pointerup", endLook);
		lookLayer.addEventListener("pointercancel", endLook);
	}

	// ---------------------------------------------------------------
	// Init
	// ---------------------------------------------------------------
	function init() {
		buildOverlay();
		window.addEventListener("resize", function () {
			Object.keys(widgetEls).forEach(function (id) {
				applyPos(widgetEls[id].el, widgetEls[id].item);
			});
		});
	}

	// Only auto-init on touch devices; desktop users can force it via
	// window.__etcForceShow = true before this script loads, useful for
	// customizing the layout on a PC before playing on a phone.
	if (isTouchDevice() || window.__etcForceShow) {
		if (document.readyState === "loading") {
			document.addEventListener("DOMContentLoaded", init);
		} else {
			init();
		}
	}

	// Expose a tiny API in case the user wants to toggle from devtools / console
	window.EaglerTouchControls = {
		show: function () { visible = true; overlay && overlay.classList.remove("etc-hidden"); },
		hide: function () { visible = false; overlay && overlay.classList.add("etc-hidden"); },
		edit: function (v) { setEditing(v === undefined ? !editing : v); },
		reset: function () { layout = defaultLayout(); saveLayout(layout); renderButtons(); },
		init: init
	};
})();
