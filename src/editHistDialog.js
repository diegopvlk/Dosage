'use strict';

import Gtk from 'gi://Gtk';

import { historyLS, treatmentsLS } from './window.js';
import { MedicationObject } from './medication.js';
import TimePicker from './timePicker.js';
import { addSaveKeyControllerToDialog } from './utils.js';

export function openEditHistDialog(DosageWindow, list, position) {
	const builder = Gtk.Builder.new_from_resource(
		'/io/github/diegopvlk/Dosage/ui/edit-hist-dialog.ui',
	);
	const item = list.get_model().get_item(position).obj;

	const editHistDialog = builder.get_object('editHistDialog');
	const editHistDialogClamp = builder.get_object('editHistDialogClamp');
	const cancelButton = builder.get_object('cancelButton');
	const saveButton = builder.get_object('saveButton');
	const nameDoseSpinRow = builder.get_object('nameDoseSpinRow');
	const takenRow = builder.get_object('takenRow');
	const histBtnSkipped = builder.get_object('histBtnSkipped');
	const histBtnConfirmed = builder.get_object('histBtnConfirmed');
	const popoverScrollTime = builder.get_object('popoverScrollTime');
	const timePicker = new TimePicker(item.taken[0]);
	popoverScrollTime.set_child(timePicker);

	nameDoseSpinRow.title = item.name;
	nameDoseSpinRow.subtitle = `${item.dose} ${item.unit}`;
	nameDoseSpinRow.value = item.dose;
	takenRow.subtitle = timePicker.entry.text;

	nameDoseSpinRow.connect('output', row => {
		nameDoseSpinRow.subtitle = `${row.get_value()} ${item.unit}`;
	});

	timePicker.entry.connect('changed', e => {
		takenRow.subtitle = e.text;
	});

	switch (item.taken[1]) {
		case 1:
			histBtnConfirmed.set_active(true);
			takenRow.title = _('Confirmed at');
			break;
		case 0:
			histBtnSkipped.set_active(true);
			takenRow.title = _('Skipped at');
			break;
		case -1:
			takenRow.title = _('Missed') + ' (?)';
			histBtnSkipped.set_active(true);
			saveButton.sensitive = false;
			break;
	}

	histBtnConfirmed.connect('clicked', () => {
		takenRow.title = _('Confirmed at');
		histBtnSkipped.set_active(false);
		histBtnConfirmed.set_active(true);
		saveButton.sensitive = true;
	});
	histBtnSkipped.connect('clicked', () => {
		takenRow.title = _('Skipped at');
		histBtnSkipped.set_active(true);
		histBtnConfirmed.set_active(false);
		saveButton.sensitive = true;
	});

	cancelButton.connect('clicked', () => editHistDialog.force_close());

	saveButton.connect('clicked', () => {
		saveHistoryItem();
		editHistDialog.force_close();
		return;
	});

	addSaveKeyControllerToDialog(editHistDialog, saveButton);

	const [editHistDialogClampHeight] = editHistDialogClamp.measure(Gtk.Orientation.VERTICAL, -1);
	editHistDialog.content_height = editHistDialogClampHeight + 48;
	editHistDialog.present(DosageWindow);

	function saveHistoryItem() {
		const tempTaken0 = item.taken[0];
		const tempTaken1 = item.taken[1];

		let missedDose = 0;
		if (item.taken[1] === -1) missedDose = +item.dose;
		let skippedDose = 0;
		if (item.taken[1] === 0) skippedDose = +item.dose;
		let confirmedDose = 0;
		if (item.taken[1] === 1) confirmedDose = +item.dose;

		if (histBtnSkipped.get_active()) item.taken[1] = 0;
		else if (histBtnConfirmed.get_active()) item.taken[1] = 1;

		if (item.taken[1] === -1) return;

		const dateTaken = new Date(item.taken[0]);
		dateTaken.setHours(timePicker.hours);
		dateTaken.setMinutes(timePicker.minutes);

		item.taken[0] = dateTaken.getTime();

		const updatedItem = new MedicationObject({
			obj: {
				name: item.name,
				unit: item.unit,
				time: item.time,
				dose: nameDoseSpinRow.value,
				color: item.color,
				taken: [dateTaken.getTime(), item.taken[1]],
			},
		});

		const it = list.get_model().get_item(position);
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

			DosageWindow._updateJsonFile('history', historyLS);
			DosageWindow._setShowHistoryAmount();
		} else {
			return;
		}

		list.scroll_to(Math.max(0, position - 1), Gtk.ListScrollFlags.FOCUS, null);

		for (const i of treatmentsLS) {
			const sameItem = i.obj.name === item.name && i.obj.inventory.enabled;

			if (sameItem) {
				let tempInv = i.obj.inventory.current;

				if (item.taken[1] === 0) {
					i.obj.inventory.current += confirmedDose;
				} else {
					const diff = item.dose - nameDoseSpinRow.value;
					const adjusts = skippedDose + missedDose;
					i.obj.inventory.current += diff - adjusts;
				}

				if (tempInv === i.obj.inventory.current) break;

				// trigger signal to update labels
				i.notify('obj');

				DosageWindow._updateJsonFile('treatments', treatmentsLS);
				DosageWindow._checkInventory();
			}
		}
	}
}
