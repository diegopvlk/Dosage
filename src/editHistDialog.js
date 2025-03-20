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
	const takenButtons = builder.get_object('takenButtons');
	const popoverScrollTime = builder.get_object('popoverScrollTime');
	const date = new Date(item.taken[0]);

	if (item.taken[1] === -1) {
		date.setHours(item.time[0]);
		date.setMinutes(item.time[1]);
	}

	const timePicker = new TimePicker(date);
	popoverScrollTime.set_child(timePicker);

	nameDoseSpinRow.title = item.name;
	nameDoseSpinRow.subtitle = `${item.dose} ${item.unit}`;
	nameDoseSpinRow.value = item.dose;
	takenRow.subtitle = timePicker.entry.text;

	let confirmActivated = false;

	nameDoseSpinRow.connect('output', row => {
		nameDoseSpinRow.subtitle = `${row.get_value()} ${item.unit}`;
	});

	timePicker.entry.connect('changed', e => {
		if (takenRow.subtitle != e.text) {
			takenRow.subtitle = e.text;

			const confirmActive = takenButtons.active_name === 'confirmed';

			if (confirmActive) {
				takenRow.title = _('Confirmed at');
				confirmActivated = true;
			}
		}
	});

	switch (item.taken[1]) {
		case 2:
			takenButtons.active_name = 'confirmed';
			takenRow.title = _('Auto-confirmed');
			break;
		case 1:
			takenButtons.active_name = 'confirmed';
			takenRow.title = _('Confirmed at');
			break;
		case 0:
			takenButtons.active_name = 'skipped';
			takenRow.title = _('Skipped at');
			break;
		case -1:
			takenButtons.active_name = 'skipped';
			takenRow.title = _('Missed') + ' (?)';
			saveButton.sensitive = false;
			break;
		case 3:
			takenButtons.active_name = 'confirmed';
			takenRow.title = _('Confirmed');
			takenRow.subtitle = _('Time unknown');
			break;
	}

	takenButtons.connect('notify::active', () => {
		saveButton.sensitive = true;
		takenRow.subtitle = timePicker.entry.text;

		switch (takenButtons.active_name) {
			case 'confirmed':
				takenRow.title = _('Confirmed at');
				confirmActivated = true;
				break;
			case 'skipped':
				takenRow.title = _('Skipped at');
		}
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

		const skipActive = takenButtons.active_name === 'skipped';
		const confirmActive = takenButtons.active_name === 'confirmed';

		if (skipActive) item.taken[1] = 0;
		else if (confirmActivated && confirmActive) item.taken[1] = 1;
		else if (tempTaken1 === 2 && confirmActive) item.taken[1] = 2;
		else if (tempTaken1 === 3 && confirmActive) item.taken[1] = 3;
		else item.taken[1] = 1;

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

			DosageWindow.updateJsonFile('history', historyLS);
			DosageWindow.setShowHistoryAmount();
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

				DosageWindow.updateJsonFile('treatments', treatmentsLS);
				DosageWindow.checkInventory();
			}
		}
	}
}
