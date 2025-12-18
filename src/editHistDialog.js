'use strict';

import Adw from 'gi://Adw?version=1';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import { getDosageWindow } from './main.js';
import { MedicationObject } from './medication.js';
import TimePicker from './timePicker.js';
import { addSaveKeyControllerToDialog } from './utils/helpers.js';
import { historyLS, treatmentsLS } from './window.js';

export const EditHistDialog = GObject.registerClass(
	{
		GTypeName: 'EditHistDialog',
		Template: 'resource:///io/github/diegopvlk/Dosage/ui/edit-hist-dialog.ui',
		InternalChildren: [
			'editHistDialogClamp',
			'saveButton',
			'popoverScrollTime',
			'nameDoseSpinRow',
			'takenRow',
			'takenButtons',
		],
	},
	class EditHistDialog extends Adw.Dialog {
		constructor(listView, itemPosition) {
			super({});
			this._listView = listView;
			this._itemPosition = itemPosition;
			this._itemObj = listView.get_model().get_item(itemPosition).obj;
			this._initEditDialog();
		}

		_initEditDialog() {
			const date = new Date(this._itemObj.taken[0]);
			this._timePicker = new TimePicker(date);
			this._popoverScrollTime.set_child(this._timePicker);
			const item = this._itemObj;

			if (item.taken[1] === -1) {
				date.setHours(item.time[0]);
				date.setMinutes(item.time[1]);
			}

			this._nameDoseSpinRow.title = item.name;
			this._nameDoseSpinRow.subtitle = `${item.dose} ${item.unit}`;
			this._nameDoseSpinRow.value = item.dose;
			this._takenRow.subtitle = this._timePicker.entry.text;

			this._confirmActivated = false;

			switch (item.taken[1]) {
				case 2:
					this._takenButtons.active_name = 'confirmed';
					this._takenRow.title = _('Auto-Confirmed');
					break;
				case 1:
					this._takenButtons.active_name = 'confirmed';
					this._takenRow.title = _('Confirmed At');
					break;
				case 0:
					this._takenButtons.active_name = 'skipped';
					this._takenRow.title = _('Skipped At');
					break;
				case -1:
					this._takenButtons.active_name = 'skipped';
					this._takenRow.title = _('Missed') + ' (?)';
					this._saveButton.sensitive = false;
					break;
				case 3:
					this._takenButtons.active_name = 'confirmed';
					this._takenRow.title = _('Confirmed');
					this._takenRow.subtitle = _('Time Unknown');
					break;
			}

			this._nameDoseSpinRow.connect('output', row => {
				row.subtitle = `${row.get_value()} ${item.unit}`;
			});

			this._timePicker.entry.connect('changed', e => {
				if (this._takenRow.subtitle != e.text) {
					this._takenRow.subtitle = e.text;

					const confirmActive = this._takenButtons.active_name === 'confirmed';

					if (confirmActive) {
						this._takenRow.title = _('Confirmed At');
						this._confirmActivated = true;
					}
				}
			});

			addSaveKeyControllerToDialog(this, this._saveButton);

			const [editHistDialogClampHeight] = this._editHistDialogClamp.measure(
				Gtk.Orientation.VERTICAL,
				-1,
			);
			this.content_height = editHistDialogClampHeight + 48;
		}

		_handleTakenRowStatus() {
			this._saveButton.sensitive = true;
			this._takenRow.subtitle = this._timePicker.entry.text;

			switch (this._takenButtons.active_name) {
				case 'confirmed':
					this._takenRow.title = _('Confirmed At');
					this._confirmActivated = true;
					break;
				case 'skipped':
					this._takenRow.title = _('Skipped At');
			}
		}

		_saveHistoryItem() {
			const dosageWindow = getDosageWindow();
			const item = this._itemObj;

			const tempTaken0 = item.taken[0];
			const tempTaken1 = item.taken[1];

			let missedDose = 0;
			let skippedDose = 0;
			let confirmedDose = 0;

			switch (item.taken[1]) {
				case -1:
					missedDose = +item.dose;
					break;
				case 0:
					skippedDose = +item.dose;
					break;
				default:
					confirmedDose = +item.dose;
			}

			const skipActive = this._takenButtons.active_name === 'skipped';
			const confirmActive = this._takenButtons.active_name === 'confirmed';

			if (skipActive) item.taken[1] = 0;
			else if (this._confirmActivated && confirmActive) item.taken[1] = 1;
			else if (tempTaken1 === 2 && confirmActive) item.taken[1] = 2;
			else if (tempTaken1 === 3 && confirmActive) item.taken[1] = 3;
			else item.taken[1] = 1;

			if (item.taken[1] === -1) return;

			const dateTaken = new Date(item.taken[0]);
			dateTaken.setHours(this._timePicker.hours);
			dateTaken.setMinutes(this._timePicker.minutes);

			item.taken[0] = dateTaken.getTime();

			const updatedItem = new MedicationObject({
				obj: {
					name: item.name,
					unit: item.unit,
					time: item.time,
					dose: this._nameDoseSpinRow.value,
					color: item.color,
					taken: [dateTaken.getTime(), item.taken[1]],
				},
			});

			const it = this._listView.get_model().get_item(this._itemPosition);
			const [, pos] = historyLS.find(it);

			const updItem = updatedItem.obj;

			if (
				updItem.taken[0] !== tempTaken0 ||
				updItem.taken[1] !== tempTaken1 ||
				updItem.dose !== item.dose
			) {
				historyLS.remove(pos);

				historyLS.insert_sorted(updatedItem, (a, b) => {
					const dateA = a.obj.taken[0];
					const dateB = b.obj.taken[0];
					if (dateA < dateB) return 1;
					else if (dateA > dateB) return -1;
					else return 0;
				});

				dosageWindow.updateJsonFile('history', historyLS);
				dosageWindow.setShowHistoryAmount();
			} else {
				return;
			}

			this._listView.scroll_to(
				Math.max(0, this._itemPosition - 1),
				Gtk.ListScrollFlags.FOCUS,
				null,
			);

			for (const i of treatmentsLS) {
				const sameItem = i.obj.name === item.name && i.obj.inventory.enabled;

				if (sameItem) {
					let tempInv = i.obj.inventory.current;

					if (item.taken[1] === 0) {
						i.obj.inventory.current += confirmedDose;
					} else {
						const diff = item.dose - this._nameDoseSpinRow.value;
						const adjusts = skippedDose + missedDose;
						i.obj.inventory.current += diff - adjusts;
					}

					if (tempInv === i.obj.inventory.current) break;

					// trigger signal to update labels
					i.notify('obj');

					dosageWindow.updateJsonFile('treatments', treatmentsLS);
					dosageWindow.checkInventory();
				}
			}
		}

		_closeDialog() {
			this.force_close();
		}

		_save() {
			this._saveHistoryItem();
			this.force_close();
		}
	},
);
