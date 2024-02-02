/*
 * Copyright 2023 Diego Povliuk
 * SPDX-License-Identifier: GPL-3.0-only
 */
'use strict';

import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {
	addLeadZero,
	doseRow,
	getTimeBtnInput,
	handleCalendarSelect,
	removeCssColors,
	getDayLabel,
	isoWeekStart,
	getSpecificDaysLabel,
} from './utils.js';

import { MedicationObject } from './medication.js';
import { historyLS, treatmentsLS, skip } from './window.js';

export default function openMedicationWindow(DosageWindow, list, position, mode) {
	const builder = Gtk.Builder.new_from_resource('/io/github/diegopvlk/Dosage/ui/med-window.ui');

	const dateOneEntry = builder.get_object('dateOneEntry');
	const calOneEntry = builder.get_object('calOneEntry');
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

	const frequencyCycle = builder.get_object('frequencyCycle');
	const cycleActive = builder.get_object('cycleActive');
	const cycleInactive = builder.get_object('cycleInactive');
	const cycleCurrent = builder.get_object('cycleCurrent');

	const dosage = builder.get_object('dosage');
	dosage.set_expanded(true);
	const dosageAddButton = builder.get_object('dosageAddButton');
	const dosageHeader = dosage.get_first_child().get_first_child().get_first_child();
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
	const calendarStartRow = builder.get_object('calendarStartRow');
	const calendarEnd = builder.get_object('calendarEnd');
	const calendarEndRow = builder.get_object('calendarEndRow');

	calendarStartRow.subtitle = GLib.DateTime.new_now_local().format('%x');
	calendarEndRow.subtitle = GLib.DateTime.new_now_local().format('%x');

	handleCalendarSelect(calendarStart, calendarStartRow);
	handleCalendarSelect(calendarEnd, calendarEndRow);

	// when opening an existing treatment
	if (list && position >= 0 && !mode) {
		medWindow.title = _('Edit treatment');
		saveButton.label = _('Save');
		deleteButton.set_visible(true);

		const item = list.get_model().get_item(position).obj;

		medName.text = item.name;
		medUnit.text = item.unit;
		medNotes.text = item.notes ? item.notes : '';

		for (const clr of dosageColorBox) {
			if (clr.get_name() === item.color) {
				dosageColorButton.add_css_class(item.color + '-clr');
				dosageColorButton.name = clr.get_name();
			}
		}
		for (const icn of dosageIconBox) {
			const icon = item.icon + '-symbolic';
			if (icn.get_icon_name() === icon) {
				dosageIconButton.set_icon_name(icon);
			}
		}

		setFreqMenuVisibility(item);
		if (item.frequency === 'specific-days') {
			frequencyMenu.subtitle = getSpecificDaysLabel(item);
		}

		item.dosage.forEach(timeDose => {
			dosage.add_row(doseRow(timeDose));
		});

		if (item.recurring) {
			recurringNotif.set_enable_expansion(item.recurring.enabled);
			recurringInterval.value = item.recurring.interval;
		}

		if (item.days && item.days.length !== 0) {
			const specificDaysBox = builder.get_object('specificDaysBox');

			let day = isoWeekStart ? 1 : 0;

			for (const btn of specificDaysBox) {
				for (const d of item.days) {
					if (d === day) btn.set_active(true);
				}
				day = (day + 1) % 7;
			}
		}

		if (item.cycle && item.cycle.length !== 0) {
			const [active, inactive, current] = item.cycle;

			cycleActive.value = active;
			cycleInactive.value = inactive;
			cycleCurrent.value = current;

			cycleCurrent.adjustment.set_upper(active + inactive);

			if (item.frequency === 'cycle') {
				frequencyMenu.subtitle = `${active} ⊷ ${inactive}`;
			}
		}

		if (item.inventory.enabled) {
			medInventory.set_enable_expansion(true);
		}
		medCurrrentInv.value = item.inventory.current;
		medReminderInv.value = item.inventory.reminder;

		if (item.duration.enabled) {
			medDuration.set_enable_expansion(true);

			// this parsing is in seconds
			const localTZ = GLib.TimeZone.new_local();
			const start = GLib.DateTime.new_from_unix_utc(item.duration.start / 1000);
			const end = GLib.DateTime.new_from_unix_utc(item.duration.end / 1000);
			const startTZ = start.to_timezone(localTZ);
			const endTZ = end.to_timezone(localTZ);

			calendarStart.select_day(startTZ);
			calendarEnd.select_day(endTZ);
		}
	}

	// when activating one-time entry button
	let existingEntry = false;
	if (mode === 'one-time') {
		const frequencyMenu = builder.get_object('frequencyMenu');
		const colorIcon = builder.get_object('colorIcon');
		const oneTimeEntries = builder.get_object('oneTimeEntries');
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

		dateOneEntry.subtitle = GLib.DateTime.new_now_local().format('%x');
		handleCalendarSelect(calOneEntry, dateOneEntry, true);

		if (DosageWindow._treatmentsList.model.get_n_items() > 0) {
			oneTimeMenuRow.set_visible(true);
			for (const it of treatmentsLS) {
				const item = it.obj;
				const btn = new Gtk.Button({
					css_classes: ['flat', 'one-time-name'],
					label: item.name,
				});
				btn.remove_css_class('text-button');
				btn.get_first_child().set_halign(Gtk.Align.START);

				btn.connect('clicked', () => {
					removeCssColors(dosageColorButton);
					dosageColorButton.add_css_class(item.color + '-clr');
					oneTimeEntries.get_parent().get_parent().popdown();

					medName.text = item.name;
					medUnit.text = item.unit;
					dosageColorButton.name = item.color;
					doseRowOne.set_value(item.dosage[0].dose);

					medName.sensitive = false;
					medUnit.sensitive = false;
					colorIcon.sensitive = false;
					existingEntry = true;
				});
				oneTimeEntries.append(btn);
			}
		}

		medWindow.title = _('New entry');
		saveButton.label = _('Confirm');
		colorIcon.subtitle = _('Color');
		colorIcon.title = '';
		medWindow.add_css_class('one-time');

		dateOneEntry.set_visible(true);
		medNotes.set_visible(false);
		dosageIconButton.set_visible(false);
		frequencyMenu.set_visible(false);
		medDuration.set_visible(false);
		dosageAddButton.get_parent().get_parent().set_visible(false);
		medInventory.set_visible(false);
		recurringNotif.set_visible(false);
	}

	// when editing history entry
	if (mode === 'edit-hist') {
		const item = list.get_model().get_item(position).obj;
		const frequencyMenu = builder.get_object('frequencyMenu');
		const colorIcon = builder.get_object('colorIcon');

		const takenButtons = builder.get_object('takenButtons');
		const histBtnSkipped = builder.get_object('histBtnSkipped');
		const histBtnConfirmed = builder.get_object('histBtnConfirmed');
		existingEntry = true;

		const date = new Date(item.taken[0]);
		let h = item.time[0];
		let m = item.time[1];

		if (item.taken[1] !== -1) {
			h = date.getHours();
			m = date.getMinutes();
		}

		const doseRowOne = doseRow({ time: [h, m], dose: item.dose });

		if (item.taken[1] === 1) histBtnConfirmed.set_active(true);
		if (item.taken[1] === 0) histBtnSkipped.set_active(histBtnConfirmed);

		// hide the remove dose button
		doseRowOne
			.get_first_child()
			.get_first_child()
			.get_first_child()
			.get_first_child()
			.set_visible(false);

		dosage.add_row(doseRowOne);

		medWindow.title = _('Edit entry');
		saveButton.label = _('Save');
		medWindow.add_css_class('one-time');
		medWindow.height_request = 192;

		takenButtons.set_visible(true);
		medName.set_visible(false);
		medUnit.set_visible(false);
		medNotes.set_visible(false);
		colorIcon.set_visible(false);
		medNotes.set_visible(false);
		dosageIconButton.set_visible(false);
		frequencyMenu.set_visible(false);
		medDuration.set_visible(false);
		dosageAddButton.get_parent().get_parent().set_visible(false);
		medInventory.set_visible(false);
		recurringNotif.set_visible(false);
	}

	setFreqMenuVisibility();

	cycleActive.connect('output', handleCycle);
	cycleInactive.connect('output', handleCycle);

	for (const button of specificDaysBox) {
		button.connect('toggled', setSpecificDaysFreqLabel);
	}

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
	};

	const medWindowBox = builder.get_object('medWindowBox');
	const [medWindowBoxHeight] = medWindowBox.measure(Gtk.Orientation.VERTICAL, -1);
	medWindow.default_height = medWindowBoxHeight + 58;

	if (deleteButton.get_visible()) {
		medWindow.default_height -= 12;
	}

	setSpecificDaysButtonOrder();

	medWindow.present();

	cancelButton.connect('clicked', () => medWindow.destroy());

	saveButton.connect('clicked', () => {
		const isUpdate = list && position >= 0;

		if (!isValidInput(isUpdate)) {
			return;
		}

		if (mode === 'one-time') {
			addItemToHistory();
			DosageWindow._updateJsonFile('history', historyLS);
		} else if (mode === 'edit-hist') {
			editHistoryItem();
			medWindow.destroy();
			return;
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

		dialog.add_response('cancel', _('Cancel'));
		dialog.add_response('delete', _('Delete'));
		dialog.set_response_appearance('delete', Adw.ResponseAppearance.DESTRUCTIVE);
		dialog.present();

		dialog.connect('response', (_self, response) => {
			if (response === 'delete') {
				const it = DosageWindow._treatmentsList.model.get_item(position);
				const deletePos = treatmentsLS.find(it)[1];
				treatmentsLS.remove(deletePos);
				DosageWindow._updateEverything('skipHistUp');
				DosageWindow._scheduleNotifications('deleting');
				medWindow.destroy();
			}
		});
	});

	function editHistoryItem() {
		const histBtnSkipped = builder.get_object('histBtnSkipped');
		const histBtnConfirmed = builder.get_object('histBtnConfirmed');
		const item = list.get_model().get_item(position).obj;
		const tempTaken0 = item.taken[0];
		const tempTaken1 = item.taken[1];

		let missedDose = 0;
		if (item.taken[1] === -1) missedDose = +item.dose;
		let skippedDose = 0;
		if (item.taken[1] === 0) skippedDose = +item.dose;
		let confirmedDose = 0;
		if (item.taken[1] === 1) confirmedDose = +item.dose;

		if (histBtnSkipped.get_active()) item.taken[1] = 0;
		if (histBtnConfirmed.get_active()) item.taken[1] = 1;
		if (item.taken[1] === -1) return;

		const dateTaken = new Date(item.taken[0]);
		dateTaken.setHours(getDoses()[0].time[0]);
		dateTaken.setMinutes(getDoses()[0].time[1]);

		item.taken[0] = dateTaken.getTime();

		const updatedItem = new MedicationObject({
			obj: {
				name: item.name,
				unit: item.unit,
				time: item.time,
				dose: getDoses()[0].dose,
				color: item.color,
				taken: [dateTaken.getTime(), item.taken[1]],
			},
		});

		skip.itemsChanged = true;

		const it = list.get_model().get_item(position);
		const [, pos] = historyLS.find(it);
		historyLS.splice(pos, 1, [updatedItem]);
		historyLS.sort(() => null);

		skip.itemsChanged = false;

		for (const i of treatmentsLS) {
			const sameItem = i.obj.name === item.name && i.obj.inventory.enabled;

			if (sameItem) {
				let tempInv = i.obj.inventory.current;
				if (item.taken[1] === 0) {
					i.obj.inventory.current += confirmedDose;
				} else {
					const diff = item.dose - getDoses()[0].dose;
					const adjusts = skippedDose + missedDose;
					i.obj.inventory.current += diff - adjusts;
				}
				if (tempInv === i.obj.inventory.current) break;
				DosageWindow._treatmentsList.model = new Gtk.NoSelection({
					model: treatmentsLS,
				});
				DosageWindow._updateJsonFile('treatments', treatmentsLS);
			}
		}

		const updItem = updatedItem.obj;

		if (
			updItem.taken[0] !== tempTaken0 ||
			updItem.taken[1] !== tempTaken1 ||
			updItem.dose !== item.dose
		) {
			DosageWindow._updateJsonFile('history', historyLS);
		}
	}

	function addItemToHistory() {
		const calOneEntry = builder.get_object('calOneEntry');
		const dt = +calOneEntry.get_date().format('%s') * 1000;
		const entryDate = new Date(dt);
		const dosage = getDoses()[0];

		entryDate.setHours(dosage.time[0]);
		entryDate.setMinutes(dosage.time[1]);

		const item = new MedicationObject({
			obj: {
				name: medName.text.trim(),
				unit: medUnit.text.trim(),
				time: [dosage.time[0], dosage.time[1]],
				dose: dosage.dose,
				color: dosageColorButton.get_name(),
				taken: [entryDate.getTime(), 1],
			},
		});

		historyLS.insert_sorted(item, (a, b) => {
			return a.obj.taken[0] > b.obj.taken[0] ? -1 : 0;
		});

		const todayDt = new Date().setHours(0, 0, 0, 0);
		const entryDt = entryDate.setHours(0, 0, 0, 0);

		if (todayDt !== entryDt) return;

		// if it's the time as of an existing item
		// update lastTaken if entryDate is today
		for (const it of treatmentsLS) {
			const i = it.obj;
			const newIt = item.obj;
			i.dosage.forEach(timeDose => {
				const sameName = i.name === newIt.name;
				const sameTime = String(timeDose.time) === String(newIt.time);
				if (sameName && sameTime) {
					timeDose.lastTaken = new Date().toISOString();
				}
			});
		}

		historyLS.sort(() => null);
		DosageWindow._historyList.scroll_to(0, null, null);
	}

	function addOrUpdateTreatment() {
		const isUpdate = list && position >= 0;
		const today = new GLib.DateTime();

		let days = [];
		let doses = [];
		let cycle = [];
		let invEnabled = false;
		let durEnabled = false;
		let name,
			unit,
			notes,
			color,
			freq,
			icon,
			recurring,
			inventory,
			current,
			reminder,
			duration,
			start,
			end;

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

		name = medName.text.trim();
		unit = medUnit.text.trim();
		notes = medNotes.text.trim();
		days = getSpecificDays();
		doses = getDoses();
		recurring = {};
		recurring.enabled = recurringNotif.get_enable_expansion();
		recurring.interval = recurringInterval.get_value();
		cycle[0] = cycleActive.adjustment.value;
		cycle[1] = cycleInactive.adjustment.value;
		cycle[2] = cycleCurrent.adjustment.value;
		color = dosageColorButton.get_name();
		icon = dosageIconButton.get_icon_name().replace('-symbolic', '');
		current = medCurrrentInv.value;
		reminder = medReminderInv.value;
		inventory = { enabled: invEnabled, current: current, reminder: reminder };
		duration = { enabled: durEnabled, start: start, end: end };

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
			const item = list.get_model().get_item(position).obj;
			doses = doses.map((dose, idx) => {
				return {
					time: dose.time,
					dose: dose.dose,
					lastTaken: item.dosage[idx]?.lastTaken || null,
				};
			});
			treatmentsLS.remove(position);
		} else {
			doses.forEach(dose => {
				dose.lastTaken = null;
			});
		}

		treatmentsLS.insert_sorted(
			new MedicationObject({
				obj: {
					name: name,
					unit: unit,
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
				},
			}),
			(a, b) => {
				const name1 = a.obj.name;
				const name2 = b.obj.name;
				return name1.localeCompare(name2);
			},
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
		let day = isoWeekStart ? 1 : 0;

		for (const button of specificDaysBox) {
			if (button.get_active()) {
				if (!days.includes(day)) {
					days.push(day);
				}
			}
			day = (day + 1) % 7;
		}
		return days.sort();
	}

	function setSpecificDaysButtonOrder() {
		let day = isoWeekStart ? 1 : 0;

		for (const button of specificDaysBox) {
			button.label = getDayLabel(day);
			day = (day + 1) % 7;
		}
	}

	function setSpecificDaysFreqLabel() {
		if (getSpecificDays().length === 0) {
			frequencyMenu.subtitle = _('Choose');
		} else {
			frequencyMenu.subtitle = getSpecificDaysLabel({
				days: getSpecificDays(),
			});
		}
	}

	function handleCycle() {
		const sum = cycleActive.value + cycleInactive.value;
		frequencyMenu.subtitle = cycleActive.value + ' ⊷ ' + cycleInactive.value;
		cycleCurrent.adjustment.set_upper(sum);
		if (cycleCurrent.adjustment.value > sum) {
			cycleCurrent.adjustment.value = sum;
		}
	}

	function setFreqMenuVisibility(item) {
		const frequencyMenu = builder.get_object('frequencyMenu');
		const freqRowPrefixes = frequencyMenu.get_first_child().get_first_child();
		freqRowPrefixes.set_visible(
			frequencyMenu.get_selected() === 1 || frequencyMenu.get_selected() === 2,
		);

		frequencyMenu.connect('notify::selected-item', () => {
			const selected = frequencyMenu.get_selected();
			frequencySpecificDays.set_visible(selected === 1);
			freqRowPrefixes.set_visible(selected === 1);
			frequencyCycle.set_visible(selected === 2);
			freqRowPrefixes.set_visible(selected === 1 || selected === 2);

			if (selected === 1) {
				frequencyMenu.title = _('Specific days');
				setSpecificDaysFreqLabel();
			} else if (selected === 2) {
				frequencyMenu.title = _('Cycle');
				handleCycle();
			} else {
				frequencyMenu.title = _('Frequency');
			}

			if (selected !== 3) {
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
			if (item.frequency === 'daily') frequencyMenu.set_selected(0);
			if (item.frequency === 'specific-days') frequencyMenu.set_selected(1);
			if (item.frequency === 'cycle') frequencyMenu.set_selected(2);
			if (item.frequency === 'when-needed') frequencyMenu.set_selected(3);
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
			const i = it.obj;
			if (isUpdate) {
				const item = list.get_model().get_item(position).obj;
				if (i === item) continue;
			}
			if (i.name.toLowerCase() === medName.text.trim().toLowerCase()) {
				toastOverlay.add_toast(new Adw.Toast({ title: _('Name already exists') }));
				medName.add_css_class('error');
				return;
			}
		}

		let currentDoseRow = listRows.get_first_child();
		const rows = [];

		while (currentDoseRow) {
			const [hours, minutes, ampm, timeBtn] = getTimeBtnInput(currentDoseRow);
			const time = String([hours, minutes]);

			if (rows.includes(time)) {
				toastOverlay.add_toast(new Adw.Toast({ title: _('Duplicated time') }));
				(async function () {
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
