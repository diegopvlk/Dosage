'use strict';

import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import { historyLS, treatmentsLS } from './window.js';
import { MedicationObject } from './medication.js';
import { handleCalendarSelect } from './utils.js';
import TimePicker from './timePicker.js';

export function openOneTimeDialog(DosageWindow) {
	const builder = Gtk.Builder.new_from_resource(
		'/io/github/diegopvlk/Dosage/ui/one-time-dialog.ui',
	);

	const toastOverlay = builder.get_object('toastOverlay');
	const toast = new Adw.Toast();
	const oneTimeDialog = builder.get_object('oneTimeDialog');
	const oneTimeDialogClamp = builder.get_object('oneTimeDialogClamp');
	const medName = builder.get_object('medName');
	const colorBox = builder.get_object('colorBox');
	const colorButton = builder.get_object('colorButton');
	const colorPopover = builder.get_object('colorPopover');
	const medUnit = builder.get_object('medUnit');
	const medAmount = builder.get_object('medAmount');
	const medTime = builder.get_object('medTime');
	const dateOneEntry = builder.get_object('dateOneEntry');
	const calOneEntry = builder.get_object('calOneEntry');
	const oneTimePopover = builder.get_object('oneTimePopover');
	const confirmBtn = builder.get_object('confirmBtn');
	const oneTimeBtnRow = builder.get_object('oneTimeBtnRow');

	const oneTimeEntries = builder.get_object('oneTimeEntries');
	const popoverScrollTime = builder.get_object('popoverScrollTime');
	const timePicker = new TimePicker();
	popoverScrollTime.set_child(timePicker);

	const calendarDate = GLib.DateTime.new_now_local();
	const calDate = calendarDate.format('%x');

	for (const clr of colorBox) {
		clr.connect('clicked', () => {
			const cssClasses = [clr.get_name() + '-clr', 'circular'];
			colorButton.set_css_classes(cssClasses);
			colorButton.name = clr.get_name();
			colorPopover.popdown();
		});
	}

	const btnNew = new Gtk.Button({
		css_classes: ['flat'],
		can_shrink: true,
		label: _('New'),
	});

	btnNew.remove_css_class('text-button');
	btnNew.get_first_child().set_halign(Gtk.Align.START);
	btnNew.get_first_child().set_max_width_chars(50);
	oneTimeEntries.append(btnNew);

	btnNew.connect('clicked', () => {
		oneTimePopover.popdown();
		medName.text = '';
		medUnit.text = _('Pill(s)');
		colorButton.set_css_classes(['circular']);
		colorButton.name = 'default';
		medAmount.value = 1;
		medName.sensitive = true;
		medUnit.sensitive = true;
		existingEntry = false;
		toast.dismiss();
	});

	dateOneEntry.subtitle = calDate;
	handleCalendarSelect(calOneEntry, dateOneEntry, true);

	oneTimeBtnRow.get_child().append(oneTimePopover);
	oneTimeBtnRow.connect('activated', _ => oneTimePopover.popup());

	let existingEntry = false;

	if (DosageWindow._treatmentsList.model.get_n_items() > 0) {
		oneTimeBtnRow.sensitive = true;
		for (const it of treatmentsLS) {
			const item = it.obj;
			const btn = new Gtk.Button({
				css_classes: ['flat', 'one-time-name'],
				can_shrink: true,
				label: item.name,
				width_request: 120,
			});

			btn.get_first_child().set_max_width_chars(50);
			btn.remove_css_class('text-button');
			btn.get_first_child().set_halign(Gtk.Align.START);

			btn.connect('clicked', () => {
				const cssClasses = [item.color + '-clr', 'circular'];
				colorButton.set_css_classes(cssClasses);
				oneTimePopover.popdown();

				medName.text = item.name;
				medUnit.text = item.unit;
				colorButton.name = item.color;
				medAmount.value = item.dosage[0].dose;

				medName.sensitive = false;
				medUnit.sensitive = false;
				confirmBtn.sensitive = true;
				existingEntry = true;
				toast.dismiss();
			});
			oneTimeEntries.append(btn);
		}
	}

	oneTimeDialog.set_presentation_mode(2);

	medTime.subtitle = timePicker.entry.text;

	timePicker.entry.connect('changed', e => {
		medTime.subtitle = e.text;
	});

	confirmBtn.connect('clicked', () => {
		if (!isValidInput()) return;
		addSingleItemToHistory();
		DosageWindow._updateEverything(null, null, 'skipCycleUp');
		oneTimeDialog.force_close();
		DosageWindow._scheduleNotifications('saving');
	});

	const [oneTimeDialogClampHeight] = oneTimeDialogClamp.measure(Gtk.Orientation.VERTICAL, -1);
	oneTimeDialog.content_height = oneTimeDialogClampHeight + 48;
	oneTimeDialog.present(DosageWindow);

	const setConfirmBtn = () => {
		if (medName.text.trim() == '' || medUnit.text.trim() == '') {
			confirmBtn.sensitive = false;
		} else {
			confirmBtn.sensitive = true;
		}
	};

	medName.connect('changed', name => {
		name.remove_css_class('error');
		setConfirmBtn();
		toast.dismiss();
	});
	medUnit.connect('changed', unit => {
		unit.remove_css_class('error');
		setConfirmBtn();
		toast.dismiss();
	});

	function isValidInput() {
		if (existingEntry) return true;

		for (const it of treatmentsLS) {
			const i = it.obj;
			if (i.name.toLowerCase() === medName.text.trim().toLowerCase()) {
				toast.title = _('Name already on treatment list');
				toastOverlay.add_toast(toast);
				medName.add_css_class('error');
				return;
			}
		}

		return true;
	}

	function addSingleItemToHistory() {
		const calOneEntry = builder.get_object('calOneEntry');
		const dt = +calOneEntry.get_date().format('%s') * 1000;
		const entryDate = new Date(dt);
		const dose = medAmount.value;
		const h = timePicker.hours;
		const m = timePicker.minutes;

		entryDate.setHours(timePicker.hours);
		entryDate.setMinutes(timePicker.minutes);
		entryDate.setSeconds(new Date().getSeconds());

		const item = new MedicationObject({
			obj: {
				name: medName.text.trim(),
				unit: medUnit.text.trim(),
				time: [h, m],
				dose: dose,
				color: colorButton.get_name(),
				taken: [entryDate.getTime(), 1],
			},
		});

		historyLS.insert_sorted(item, (a, b) => {
			const dateA = a.obj.taken[0];
			const dateB = b.obj.taken[0];
			if (dateA < dateB) return 1;
			else if (dateA > dateB) return -1;
			else return 0;
		});

		const todayDt = new Date().setHours(0, 0, 0, 0);
		const entryDt = entryDate.setHours(0, 0, 0, 0);

		for (const it of treatmentsLS) {
			const i = it.obj;
			const newIt = item.obj;
			const sameName = i.name === newIt.name;
			const updateInv = sameName && i.inventory.enabled;

			// if it's the time as of an existing item
			// update lastTaken if entryDate is today
			if (todayDt === entryDt) {
				i.dosage.forEach(timeDose => {
					const sameTime = String(timeDose.time) === String(newIt.time);
					if (sameName && sameTime) {
						timeDose.lastTaken = new Date().toISOString();
					}
				});
			}

			if (updateInv) {
				i.inventory.current -= newIt.dose;
				// trigger signal to update labels
				it.notify('obj');
				break;
			}
		}
	}
}
