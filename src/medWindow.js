'use strict';

import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';

import {
	addLeadZero,
	doseRow,
	getTimeBtnInput,
	handleCalendarSelect,
	removeCssColors,
	getDayLabel,
} from './utils.js';

import { Medication, HistoryMedication } from './medication.js';
import { historyLS, treatmentsLS } from './window.js';

export default function medicationWindow(DosageWindow, list, position, oneTime) {
	const builder = Gtk.Builder.new_from_resource(
		'/io/github/diegopvlk/Dosage/ui/med-window.ui'
	);

	const dateOneEntry = builder.get_object('dateOneEntry');
	const calOneEntry = builder.get_object('calOneEntry');
	const calOneEntryBtn = builder.get_object('calOneEntryBtn');
	const oneTimeMenuRow = builder.get_object('oneTimeMenu').get_parent();
	oneTimeMenuRow.set_visible(false);

	const medWindow = builder.get_object('medWindow');
	medWindow.set_modal(true);
	medWindow.set_transient_for(DosageWindow);

	const keyController = new Gtk.EventControllerKey();
	keyController.connect('key-pressed', (_, keyval, keycode, state) => {
		if (keyval === Gdk.KEY_Escape) {
			medWindow.destroy();
		}
	});
	medWindow.add_controller(keyController);

	const cancelButton = builder.get_object('cancelButton');
	const saveButton = builder.get_object('saveButton');
	const deleteButton = builder.get_object('deleteMedication');

	const medName = builder.get_object('name');
	const medUnit = builder.get_object('unit');
	const medNotes = builder.get_object('notes');

	const dosageColorButton = builder.get_object('dosageColorButton');
	const dosageIconButton = builder.get_object('dosageIconButton');
	const dosageColorBox = builder.get_object('dosageColorBox');
	const dosageIconBox = builder.get_object('dosageIconBox');

	for (const clr of dosageColorBox) {
		clr.connect('clicked', () => {
			removeCssColors(dosageColorButton);
			dosageColorButton.add_css_class(clr.get_name() + '-clr');
			dosageColorButton.name = clr.get_name();
			dosageColorBox.get_parent().get_parent().popdown();
		});
	}
	for (const icn of dosageIconBox) {
		icn.connect('clicked', () => {
			dosageIconButton.set_icon_name(icn.get_icon_name());
			dosageIconBox.get_parent().get_parent().popdown();
		});
	}

	const frequencyMenu = builder.get_object('frequencyMenu');
	const frequencySpecificDays = builder.get_object('frequencySpecificDays');
	const specificDaysBox = builder.get_object('specificDaysBox');
	const freqChooseDaysLabel = frequencySpecificDays
		.get_first_child()
		.get_first_child()
		.get_first_child();
	freqChooseDaysLabel.ellipsize = Pango.EllipsizeMode.END;

	const frequencyCycle = builder.get_object('frequencyCycle');	
	const cycleActive = builder.get_object('cycleActive');
	const cycleInactive = builder.get_object('cycleInactive');
	const cycleCurrent = builder.get_object('cycleCurrent');

	const dosage = builder.get_object('dosage');
	dosage.set_expanded(true);
	const dosageAddButton = builder.get_object('dosageAddButton');
	const dosageHeader = dosage
		.get_first_child()
		.get_first_child()
		.get_first_child();
	const dosageExpanderBtn = dosageHeader
		.get_first_child()
		.get_last_child()
		.get_first_child()
		.get_next_sibling()
		.get_next_sibling();
	dosageHeader.set_activatable(false);
	dosageExpanderBtn.set_visible(false);

	const recurringNotif = builder.get_object('recurringNotif');
	const recurringInterval = builder.get_object('recurringInterval');

	const medInventory = builder.get_object('inventory');
	const medCurrrentInv = builder.get_object('currentInventory');
	const medReminderInv = builder.get_object('reminderInventory');

	const medDuration = builder.get_object('duration');
	const calendarStart = builder.get_object('calendarStart');
	const calendarStartBtn = builder.get_object('calendarStartBtn');
	const calendarEnd = builder.get_object('calendarEnd');
	const calendarEndBtn = builder.get_object('calendarEndBtn');

	calendarStartBtn.label = GLib.DateTime.new_now_local().format('%x');
	calendarEndBtn.label = GLib.DateTime.new_now_local().format('%x');
	  
	handleCalendarSelect(calendarStart, calendarStartBtn);
	handleCalendarSelect(calendarEnd, calendarEndBtn);

	// when opening an existing treatment
	if (list && position >= 0) {
		medWindow.title = _('Edit treatment');
		saveButton.label = _('Save');
		deleteButton.set_visible(true);
		
		const item = list.get_model().get_item(position);
		const info = item.info;

		medName.text = item.name;
		medUnit.text = item.unit;
		medNotes.text = info.notes ? info.notes : '';
		
		for (const clr of dosageColorBox) {
			if (clr.get_name() === info.color) {
				dosageColorButton.add_css_class(info.color + '-clr');
				dosageColorButton.name = clr.get_name();
			}
		}
		for (const icn of dosageIconBox) {
			if (icn.get_icon_name() === info.icon) {
				dosageIconButton.set_icon_name(info.icon);
			}
		}

		setFreqMenuVisibility(item);

		info.dosage.forEach(timeDose => {
			dosage.add_row(doseRow(timeDose));
		});

		// v1.1.0 only has recurring: boolean
		if (info.recurring) {
			const recurrEnabled = info.recurring.enabled || info.recurring === true;
			recurringNotif.set_enable_expansion(recurrEnabled);
			recurringInterval.value = info.recurring.interval || 5;
		}

		if (info.days && info.days.length !== 0) {
			const specificDaysBox = builder.get_object('specificDaysBox');

			let day = 0;
			for (const btn of specificDaysBox) {
				for (const d of info.days) {
					if (d === day) btn.set_active(true);
				}
				day++;
			}
		}

		if (info.cycle && info.cycle.length !== 0) {
			const [active, inactive, current] = info.cycle;
			
			cycleActive.value = active;
			cycleInactive.value = inactive;
			cycleCurrent.value = current;
			
			cycleCurrent.adjustment.set_upper(active + inactive);
			
			frequencyCycle.label = `${active}  ⊷  ${inactive}`;
		}

		if (info.inventory.enabled) {
			medInventory.set_enable_expansion(true);
		}
		medCurrrentInv.value = info.inventory.current;
		medReminderInv.value = info.inventory.reminder;

		if (info.duration.enabled) {
			medDuration.set_enable_expansion(true);

			// this parsing is in seconds
			const localTZ = GLib.TimeZone.new_local();
			const start = GLib.DateTime.new_from_unix_utc(item.info.duration.start / 1000);
			const end = GLib.DateTime.new_from_unix_utc(item.info.duration.end / 1000);
			const startTZ = start.to_timezone(localTZ);
			const endTZ = end.to_timezone(localTZ);

			calendarStart.select_day(startTZ);
			calendarEnd.select_day(endTZ);
		}
	}

	// when activating one-time entry button
	let existingEntry = false;
	if (oneTime) {
		const frequency = builder.get_object('frequency');
		const colorIcon = builder.get_object('colorIcon');
		const oneTimeEntries = builder.get_object('oneTimeEntries');
		const oneTimeTaken = builder.get_object('oneTimeTaken');
		const h = new Date().getHours();
		const m = new Date().getMinutes();
		const doseRowOne = doseRow({ time: [h, m], dose: 1 });

		// hide the remove dose button
		doseRowOne
			.get_first_child()
			.get_first_child()
			.get_first_child()
			.get_first_child()
			.set_visible(false);

		dosage.add_row(doseRowOne);

		const btnNew = new Gtk.Button({
			css_classes: ['flat'],
			label: _('New'),
		});

		btnNew.remove_css_class('text-button');
		btnNew.get_first_child().set_halign(Gtk.Align.START);
		oneTimeEntries.append(btnNew);

		btnNew.connect('clicked', () => {
			oneTimeEntries.get_parent().get_parent().popdown();
			medName.text = '';
			medUnit.text = _('Pill(s)');
			removeCssColors(dosageColorButton);
			dosageColorButton.name = 'default';
			doseRowOne.set_value(1);
			medName.sensitive = true;
			medUnit.sensitive = true;
			colorIcon.sensitive = true;
			existingEntry = false;
		});

		calOneEntryBtn.label = GLib.DateTime.new_now_local().format('%x');
		handleCalendarSelect(calOneEntry, calOneEntryBtn, true);

		if (DosageWindow._treatmentsList.model.get_n_items() > 0) {
			oneTimeMenuRow.set_visible(true);
			for (const item of treatmentsLS) {
				const btn = new Gtk.Button({
					css_classes: ['flat', 'one-time-name'],
					label: item.name,
				});
				btn.remove_css_class('text-button');
				btn.get_first_child().set_halign(Gtk.Align.START);

				btn.connect('clicked', () => {
					removeCssColors(dosageColorButton);
					dosageColorButton.add_css_class(item.info.color + '-clr');
					oneTimeEntries.get_parent().get_parent().popdown();

					medName.text = item.name;
					medUnit.text = item.unit;
					dosageColorButton.name = item.info.color;
					doseRowOne.set_value(item.info.dosage[0].dose);

					medName.sensitive = false;
					medUnit.sensitive = false;
					colorIcon.sensitive = false;
					existingEntry = true;
				});
				oneTimeEntries.append(btn);
			}
		}

		medWindow.title = _('New entry');
		// TRANSLATORS: Keep it short (button to add one-time entry to history)
		saveButton.label = _('Add to history');
		colorIcon.title = _('Color');
		medWindow.add_css_class('one-time');

		dateOneEntry.set_visible(true);
		oneTimeTaken.set_visible(true);
		medNotes.set_visible(false);
		dosageIconButton.set_visible(false);
		frequency.set_visible(false);
		medDuration.set_visible(false);
		dosageAddButton.get_parent().get_parent().set_visible(false);
		medInventory.set_visible(false);
		recurringNotif.set_visible(false);
	}

	setFreqMenuVisibility();

	cycleActive.connect('output', handleCycle);
	cycleInactive.connect('output', handleCycle);

	let h = 13;
	dosageAddButton.connect('clicked', () => {
		if (h == 24) h = 0;
		dosage.add_row(doseRow({ time: [h++, 30], dose: 1 }));
	});

	const dosageBox = dosage.get_first_child();
	const listBox = dosageBox.get_first_child();
	const revealer = listBox.get_next_sibling();
	const listRows = revealer.get_first_child();
	const firstDoseRow = listRows.get_first_child();

	if (!firstDoseRow) {
		dosage.add_row(doseRow({ time: [12, 30], dose: 1 }));
	}

	globalThis.removeRow = doseRow => {
		const firstDoseRow = listRows.get_first_child();
		const lastDoseRow = listRows.get_last_child();
		
		if (firstDoseRow != lastDoseRow) {
			dosage.remove(doseRow);
		}
	}

	const medWindowBox = builder.get_object('medWindowBox');
	const [medWindowBoxHeight] = medWindowBox.measure(
		Gtk.Orientation.VERTICAL,
		-1
	);
	medWindow.default_height = medWindowBoxHeight + 58;

	if (deleteButton.get_visible()) {
		medWindow.default_height -= 12;
	}

	setSpecificDaysLabels();

	medWindow.present();

	cancelButton.connect('clicked', () => medWindow.destroy());

	saveButton.connect('clicked', () => {
		const isUpdate = list && position >= 0;

		if (!isValidInput(isUpdate)) {
			return;
		}

		if (oneTime) {
			const historyList = DosageWindow._historyList;
			const sortedHistory = DosageWindow._sortedHistoryModel;
			addItemToHistory(historyList, sortedHistory);
			DosageWindow._updateJsonFile('history', historyLS);
		} else {
			addOrUpdateTreatment();
		}

		DosageWindow._updateEverything('skipHistUp');
		DosageWindow._scheduleNotifications('saving');
		medWindow.destroy();	
	});

	deleteButton.connect('clicked', () => {
		const dialog = new Adw.MessageDialog({
			// TRANSLATORS: Message for confirmation when deleting an item
			heading: _('Are you sure?'),
			modal: true,
			transient_for: medWindow,
		});

		dialog.add_response('no', _('Cancel'));
		dialog.add_response('yes', _('Delete'));
		dialog.set_response_appearance('yes', Adw.ResponseAppearance.DESTRUCTIVE);
		dialog.present();

		dialog.connect('response', (_self, response) => {
			if (response === 'yes') {
				const it = DosageWindow._treatmentsList.model.get_item(position);
				const deletePos = treatmentsLS.find(it)[1];
				treatmentsLS.remove(deletePos);
				DosageWindow._updateEverything('skipHistUp');
				DosageWindow._scheduleNotifications('deleting');
				medWindow.destroy();
			}
		});
	});

	function addItemToHistory(histList, sortedHist) {
		const calOneEntry = builder.get_object('calOneEntry');
		const oneTimeTaken = builder.get_object('oneTimeTaken');
		const dt = +calOneEntry.get_date().format('%s') * 1000;
		const entryDate = new Date(dt);
		const info = getDoses()[0];

		let taken = 'yes';
		if (oneTime) {
			if (oneTimeTaken.get_selected() === 0) taken = 'yes';
			if (oneTimeTaken.get_selected() === 1) taken = 'no';
			if (oneTimeTaken.get_selected() === 2) taken = 'miss';
		}

		entryDate.setHours(info.time[0]);
		entryDate.setMinutes(info.time[1]);

		const item = new HistoryMedication({
			name: medName.text.trim(),
			unit: medUnit.text.trim(),
			color: dosageColorButton.get_name(),
			taken: taken,
			info: info,
			date: entryDate.toISOString(),
		});

		historyLS.insert_sorted(
			item,
			(obj1, obj2) => {
				return obj1.date > obj2.date ? -1 : 0;
			}
		);

		const todayDt = new Date().setHours(0, 0, 0, 0);
		const entryDt = entryDate.setHours(0, 0, 0, 0);

		if (todayDt !== entryDt) return;

		// if it's the time as of an existing item
		// update lastTaken if entryDate is today
		for (const i of treatmentsLS) {
			i.info.dosage.forEach(timeDose => {
					const sameName = i.name === item.name;
					const sameTime = String(timeDose.time) === String(item.info.time);
					if (sameName && sameTime) {
						timeDose.lastTaken = new Date().toISOString();
					}
				}
			);
		}

		// reload-ish of history, so the item don't get inserted 
		// on a separate section (with the same day) 
		// when the time is less than the first one of same section
		histList.model = new Gtk.NoSelection({
			model: sortedHist,
		});
	}

	function addOrUpdateTreatment() {
		const isUpdate = list && position >= 0;
		const today = new GLib.DateTime;

		let days = [];
		let doses = [];
		let cycle = [];
		let invEnabled = false;
		let durEnabled = false;
		let name, unit, notes, color, freq, icon, recurring, lastUpdate,
			inventory, current, reminder, duration, start, end;

		if (medInventory.get_enable_expansion()) {
			invEnabled = true;
		}

		if (medDuration.get_enable_expansion()) {
			durEnabled = true;
			start = +calendarStart.get_date().format('%s') * 1000;
			end = +calendarEnd.get_date().format('%s') * 1000;
		} else {
			start = +today.format('%s') * 1000;
			end = start;
		}

		name = medName.text.trim(),
		unit = medUnit.text.trim(),
		notes = medNotes.text.trim(),
		days = getSpecificDays();
		doses = getDoses();
		recurring = {};
		recurring.enabled = recurringNotif.get_enable_expansion();
		recurring.interval = recurringInterval.get_value();
		cycle[0] = cycleActive.adjustment.value;
		cycle[1] = cycleInactive.adjustment.value;
		cycle[2] = cycleCurrent.adjustment.value;
		color = dosageColorButton.get_name();
		icon = dosageIconButton.get_icon_name();
		current = medCurrrentInv.value;
		reminder = medReminderInv.value;
		inventory = { enabled: invEnabled, current: current, reminder: reminder };
		duration = { enabled: durEnabled, start: start, end: end };
		lastUpdate = new Date().toISOString();

		if (frequencyMenu.get_selected() === 0) freq = 'daily';
		if (frequencyMenu.get_selected() === 1) freq = 'specific-days';
		if (frequencyMenu.get_selected() === 2) freq = 'cycle';
		if (frequencyMenu.get_selected() === 3) freq = 'when-needed';

		doses.sort((obj1, obj2) => {
			const [h1, m1] = obj1.time;
			const [h2, m2] = obj2.time;
			const hm1 = `${addLeadZero(h1)}${addLeadZero(m1)}`;
			const hm2 = `${addLeadZero(h2)}${addLeadZero(m2)}`;
			return hm1 === hm2 ? 0 : hm1 > hm2 ? 1 : -1;
		});

		if (isUpdate) {
			const item = list.get_model().get_item(position);
			doses = doses.map((dose, idx) => {
				return {
					time: dose.time,
					dose: dose.dose,
					lastTaken: item.info.dosage[idx]?.lastTaken || null,
				};
			});
			treatmentsLS.remove(position);
		}

		treatmentsLS.insert_sorted(
			new Medication({
				name: name,
				unit: unit,
				info: {
					notes: notes,
					frequency: freq,
					color: color,
					icon: icon,
					days: days,
					cycle: cycle,
					dosage: doses,
					recurring: recurring,
					inventory: inventory,
					duration: duration,
					lastUpdate: lastUpdate,
				},
			}),
			(obj1, obj2) => {
				const name1 = obj1.name;
				const name2 = obj2.name;
				return name1.localeCompare(name2);
			}
		);
	}

	function getDoses() {
		const doses = [];
		let currentDoseRow = listRows.get_first_child();

		while (currentDoseRow) {
			const [hours, minutes] = getTimeBtnInput(currentDoseRow);
			const ds = {
				time: [hours, minutes],
				dose: currentDoseRow.get_value(),
			};
			doses.push(ds);
			currentDoseRow = currentDoseRow.get_next_sibling();
		}
		return doses;
	}

	function getSpecificDays() {
		const days = [];
		let day = 0;
		for (const button of specificDaysBox) {
			if (button.get_active()) {
				if (!days.includes(day)) {
					days.push(day)
				}
			};
			day++;
		}
		return days;
	}

	function setSpecificDaysLabels() {
		let day = 0;
		for (const button of specificDaysBox) {
			button.label = getDayLabel(day);
			day++;
		}
	}

	function handleCycle() {
		const sum = cycleActive.value + cycleInactive.value;
		frequencyCycle.label = cycleActive.value + '  ⊷  ' + cycleInactive.value;
		cycleCurrent.adjustment.set_upper(sum);
		if (cycleCurrent.adjustment.value > sum) {
			cycleCurrent.adjustment.value = sum;
		}
	}

	function setFreqMenuVisibility(item) {
		frequencyMenu.connect('notify::selected-item', () => {
			const selectedItemPos = frequencyMenu.get_selected();

			frequencySpecificDays.set_visible(selectedItemPos === 1);
			frequencyCycle.set_visible(selectedItemPos === 2);

			if (selectedItemPos != 3) {
				dosage.set_visible(true);
				medDuration.set_visible(true);
				recurringNotif.set_visible(true);
				return;
			}
			
			// if when-needed is selected, hide the dosage, duration and recurring rows
			dosage.set_visible(false);
			medDuration.set_visible(false);
			recurringNotif.set_visible(false);
		});

		if (item) {
			const freq = item.info.frequency;
			if (freq === 'daily') frequencyMenu.set_selected(0);
			if (freq === 'specific-days') frequencyMenu.set_selected(1);
			if (freq === 'cycle') frequencyMenu.set_selected(2);
			if (freq === 'when-needed') frequencyMenu.set_selected(3);
		}
	}

	function isValidInput(isUpdate) {
		if (existingEntry) return true;

		const toastOverlay = builder.get_object('toastOverlay');
		medName.connect('changed', name => name.remove_css_class('error'));
		medUnit.connect('changed', unit => unit.remove_css_class('error'));
		
		const emptyName = medName.text.trim() == '';
		const emptyUnit = medUnit.text.trim() == '';

		if (emptyName) {
			toastOverlay.add_toast(new Adw.Toast({ title: _('Empty name') }));
			medName.add_css_class('error');
			return;
		} else if (emptyUnit) {
			toastOverlay.add_toast(new Adw.Toast({ title: _('Empty unit') }));
			medUnit.add_css_class('error');
			return;
		}

		if (frequencySpecificDays.get_visible() && getSpecificDays().length == 0) {
			toastOverlay.add_toast(new Adw.Toast({ title: _('Choose at least one day') }));
			return;
		}

		for (const it of treatmentsLS) {
			if (isUpdate) {
				const item = list.get_model().get_item(position);
				if (it === item) continue;
			}
			if (it.name.toLowerCase() === medName.text.trim().toLowerCase()) {
				toastOverlay.add_toast(new Adw.Toast({ title: _('Name already exists') }));
				medName.add_css_class('error');
				return;
			}
		}

		let currentDoseRow = listRows.get_first_child();
		const rows = [];

		while (currentDoseRow) {
			const [hours, minutes, ampm, timeBtn] = getTimeBtnInput(currentDoseRow);
			const time = String([hours, minutes])

			if (rows.includes(time)) {
				toastOverlay.add_toast(new Adw.Toast({ title: _('Duplicated time') }));
				(async function() {
					timeBtn.add_css_class('time-error');
					ampm.add_css_class('time-error');
					await new Promise(res => setTimeout(res, 1400));
					timeBtn.remove_css_class('time-error');
					ampm.remove_css_class('time-error');
				})();
				return;
			} else {
				rows.push(time);
			}

			currentDoseRow = currentDoseRow.get_next_sibling();
		}
		return true;
	}
}
