/*
 * Copyright 2023 Diego Povliuk
 * SPDX-License-Identifier: GPL-3.0-only
 */
'use strict';

import Adw from 'gi://Adw?version=1';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import { getDosageWindow } from './main.js';
import { sortTreatments } from './treatmentsSorter.js';
import { addSaveKeyControllerToDialog } from './utils/helpers.js';

export const RefillDialog = GObject.registerClass(
	{
		GTypeName: 'RefillDialog',
		Template: 'resource:///io/github/diegopvlk/Dosage/ui/refill-dialog.ui',
		InternalChildren: [
			'refillDialogClamp',
			'refillRow',
			'refillInventory',
			'saveButton',
			'refillButton',
		],
	},
	class RefillDialog extends Adw.Dialog {
		constructor(listItem, itemPosition) {
			super({});
			this._listItem = listItem;
			this._itemPosition = itemPosition;
			this._itemObj = listItem.get_item().obj;
			this._initRefill();
		}

		_initRefill() {
			const itemObj = this._itemObj;
			this._refillRow.subtitle = itemObj.name;
			this._refillInventory.value = itemObj.inventory.current;
			this._refillButton.label = '+' + itemObj.inventory.refill;
			addSaveKeyControllerToDialog(this, this._saveButton);

			const [refillDialogClampHeight] = this._refillDialogClamp.measure(
				Gtk.Orientation.VERTICAL,
				-1,
			);
			this.content_height = refillDialogClampHeight + 50;
		}

		_refill() {
			this._refillInventory.value += this._itemObj.inventory.refill;
		}

		_save() {
			const dosageWindow = getDosageWindow();

			this._itemObj.inventory.current = this._refillInventory.value;

			// trigger signal to update labels
			this._listItem.get_item().notify('obj');

			const treatSort = settings.get_string('treatments-sorting');
			if (treatSort !== 'name-ascending') sortTreatments(treatSort);

			dosageWindow.updateEverything({ skipHistUp: true, skipCycleUp: true });
			const pos = Math.max(0, this._itemPosition - 1);
			dosageWindow._treatmentsList.scroll_to(pos, Gtk.ListScrollFlags.FOCUS, null);
			dosageWindow.scheduleNotifications('saving');

			this.force_close();
		}
	},
);
