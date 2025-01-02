/*
 * Copyright 2023 Diego Povliuk
 * SPDX-License-Identifier: GPL-3.0-only
 */
'use strict';

import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';

import { DosageApplication } from './main.js';
import { getWidgetByName } from './utils.js';

export function openRefillDialog(listItem, position) {
	const item = listItem.get_item().obj;
	const DosageWindow = DosageApplication.get_default().activeWindow;
	const builder = Gtk.Builder.new_from_resource('/io/github/diegopvlk/Dosage/ui/refill-dialog.ui');

	const refillDialog = builder.get_object('refillDialog');
	const refillRow = builder.get_object('refillRow');
	const refillInv = builder.get_object('refillInventory');
	const refillFlowBox = builder.get_object('refillFlowBox');
	const refill5Btn = builder.get_object('refill5Button');
	const refill10Btn = builder.get_object('refill10Button');
	const refill30Btn = builder.get_object('refill30Button');
	const refill60Btn = builder.get_object('refill60Button');
	const refill100Btn = builder.get_object('refill100Button');
	const cancelButton = builder.get_object('cancelButton');
	const saveButton = builder.get_object('saveButton');

	const keyController = new Gtk.EventControllerKey();
	keyController.connect('key-pressed', (_, keyval, keycode, state) => {
		const shiftPressed = (state & Gdk.ModifierType.SHIFT_MASK) !== 0;
		const controlPressed = (state & Gdk.ModifierType.CONTROL_MASK) !== 0;
		const enterPressed = keyval === Gdk.KEY_Return;

		if ((controlPressed || shiftPressed) && enterPressed) {
			saveButton.activate();
		}
	});
	refillDialog.add_controller(keyController);

	refillRow.subtitle = item.name;

	refillInv.value = item.inventory.current;

	refill5Btn.connect('clicked', () => (refillInv.value += 5));
	refill10Btn.connect('clicked', () => (refillInv.value += 10));
	refill30Btn.connect('clicked', () => (refillInv.value += 30));
	refill60Btn.connect('clicked', () => (refillInv.value += 60));
	refill100Btn.connect('clicked', () => (refillInv.value += 100));

	try {
		let gtkFlowBoxChild = getWidgetByName(refillFlowBox, 'GtkFlowBoxChild');
		while (gtkFlowBoxChild.get_name() === 'GtkFlowBoxChild') {
			gtkFlowBoxChild.set_focusable(false);
			gtkFlowBoxChild = gtkFlowBoxChild.get_next_sibling();
		}
	} catch (e) {}

	cancelButton.connect('clicked', () => refillDialog.force_close());

	saveButton.connect('clicked', () => {
		item.inventory.current = refillInv.value;

		// trigger signal to update labels
		listItem.get_item().notify('obj');

		DosageWindow._updateEverything('skipHistUp', null, 'skipCycleUp');
		const pos = Math.max(0, position - 1);
		DosageWindow._treatmentsList.scroll_to(pos, Gtk.ListScrollFlags.FOCUS, null);
		DosageWindow._scheduleNotifications('saving');

		refillDialog.force_close();
	});

	const refillDialogClamp = builder.get_object('refillDialogClamp');
	const [refillDialogClampHeight] = refillDialogClamp.measure(Gtk.Orientation.VERTICAL, -1);
	refillDialog.content_height = refillDialogClampHeight + 48;

	refillDialog.present(DosageWindow);
}
