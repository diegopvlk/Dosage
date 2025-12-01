/*
 * Copyright 2023 Diego Povliuk
 * SPDX-License-Identifier: GPL-3.0-only
 */
'use strict';

import Gtk from 'gi://Gtk';

import { DosageApplication } from './main.js';
import { addSaveKeyControllerToDialog } from './utils.js';

export function openRefillDialog(listItem, position) {
	const item = listItem.get_item().obj;
	const DosageWindow = DosageApplication.get_default().activeWindow;
	const builder = Gtk.Builder.new_from_resource('/io/github/diegopvlk/Dosage/ui/refill-dialog.ui');

	const refillDialog = builder.get_object('refillDialog');
	const refillRow = builder.get_object('refillRow');
	const refillInv = builder.get_object('refillInventory');
	const saveButton = builder.get_object('saveButton');
	const refillButton = builder.get_object('refillButton');

	addSaveKeyControllerToDialog(refillDialog, saveButton);

	refillRow.subtitle = item.name;

	refillInv.value = item.inventory.current;
	refillButton.label = '+' + item.inventory.refill;

	refillButton.connect('clicked', () => {
		refillInv.value += item.inventory.refill;
	});

	saveButton.connect('clicked', () => {
		item.inventory.current = refillInv.value;

		// trigger signal to update labels
		listItem.get_item().notify('obj');

		DosageWindow.updateEverything({ skipHistUp: true, skipCycleUp: true });
		const pos = Math.max(0, position - 1);
		DosageWindow._treatmentsList.scroll_to(pos, Gtk.ListScrollFlags.FOCUS, null);
		DosageWindow.scheduleNotifications('saving');

		refillDialog.force_close();
	});

	const refillDialogClamp = builder.get_object('refillDialogClamp');
	const [refillDialogClampHeight] = refillDialogClamp.measure(Gtk.Orientation.VERTICAL, -1);
	refillDialog.content_height = refillDialogClampHeight + 50;

	refillDialog.present(DosageWindow);
}
