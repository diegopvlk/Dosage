/*
 * Copyright 2023 Diego Povliuk
 * SPDX-License-Identifier: GPL-3.0-only
 */
'use strict';

import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {
	addLeadZero,
	doseRow,
	getTimeBtnInput,
	handleCalendarSelect,
	removeCssColors,
	getDayLabel,
	firstWeekday,
	getSpecificDaysLabel,
	addSaveKeyControllerToDialog,
} from './utils.js';

import { MedicationObject } from './medication.js';
import { treatmentsLS, flow } from './window.js';

export function openMedicationDialog(DosageWindow, list, position, mode) {
	const builder = Gtk.Builder.new_from_resource('/io/github/diegopvlk/Dosage/ui/med-dialog.ui');

	const medDialog = builder.get_object('medDialog');
	medDialog.set_presentation_mode(2);

	const cancelButton = builder.get_object('cancelButton');
	const saveButton = builder.get_object('saveButton');
	const deleteButton = builder.get_object('deleteMedication');

	const medName = builder.get_object('name');
	const medUnit = builder.get_object('unit');
	const medNotes = builder.get_object('notes');

	const dosageColorPopover = builder.get_object('dosageColorPopover');
	const dosageIconPopover = builder.get_object('dosageIconPopover');
	const dosageColorButton = builder.get_object('dosageColorButton');
	const dosageIconButton = builder.get_object('dosageIconButton');
	const dosageColorBox = builder.get_object('dosageColorBox');
	const dosageIconBox = builder.get_object('dosageIconBox');

	for (const clr of dosageColorBox) {
		clr.connect('clicked', () => {
			removeCssColors(dosageColorButton);
			dosageColorButton.add_css_class(clr.get_name() + '-clr');
			dosageColorButton.name = clr.get_name();
			dosageColorPopover.popdown();
		});
	}
	for (const icn of dosageIconBox) {
		icn.connect('clicked', () => {
			dosageIconButton.set_icon_name(icn.get_icon_name());
			dosageIconPopover.popdown();
		});
	}

	const frequencyMenu = builder.get_object('frequencyMenu');
	const frequencySpecificDays = builder.get_object('frequencySpecificDays');
	const specificDaysBox = builder.get_object('specificDaysBox');

	const frequencyDayOfMonth = builder.get_object('frequencyDayOfMonth');
	const dayOfMonth = builder.get_object('dayOfMonth');

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

	const calendarDate = GLib.DateTime.new_now_local();
	const calDate = calendarDate.format('%x');

	calendarStartRow.subtitle = calDate;
	calendarEndRow.subtitle = calDate;

	handleCalendarSelect(calendarStart, calendarStartRow);
	handleCalendarSelect(calendarEnd, calendarEndRow);

	// when opening/duplicating an existing treatment
	const existingTreatment = (list && position >= 0 && !mode) || mode === 'duplicate';
	if (existingTreatment) {
		if (!mode) {
			medDialog.title = _('Edit treatment');
			saveButton.label = _('Save');
			deleteButton.set_visible(true);
		}

		medDialog.set_presentation_mode(0);

		const item = list.get_model().get_item(position).obj;

		medName.text = item.name;
		medUnit.text = item.unit;
		medNotes.text = item.notes ? item.notes : '';

		if (mode === 'duplicate') {
			medDialog.set_presentation_mode(2);
			medName.text += ` (${_('Copy')})`;
		}

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

		if (item.monthDay) {
			dayOfMonth.value = item.monthDay;
		}

		if (item.frequency === 'day-of-month') {
			handleDayOfMonthLabels();
		}

		if (item.days && item.days.length !== 0) {
			const specificDaysBox = builder.get_object('specificDaysBox');

			let day = firstWeekday;

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
				frequencyMenu.subtitle = `${active} ⊷ ${inactive}`;
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

		deleteButton.connect('activated', () => {
			confirmDeleteDialog(item, position, DosageWindow, medDialog);
		});
	}

	if (!existingTreatment) setFreqMenuVisibility();

	dayOfMonth.connect('output', handleDayOfMonthLabels);

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

	const medDialogClamp = builder.get_object('medDialogClamp');

	const [medDialogClampHeight] = medDialogClamp.measure(Gtk.Orientation.VERTICAL, -1);
	medDialog.content_height = medDialogClampHeight + 48;

	setSpecificDaysButtonOrder();

	medDialog.present(DosageWindow);

	cancelButton.connect('clicked', () => medDialog.force_close());

	saveButton.connect('clicked', () => {
		const isUpdate = list && position >= 0 && !mode;

		if (!isValidInput(isUpdate)) return;

		addOrUpdateTreatment();
		DosageWindow._updateEverything('skipHistUp');
		const pos = Math.max(0, updatedItemPosition - 1);
		DosageWindow._treatmentsList.scroll_to(pos, Gtk.ListScrollFlags.FOCUS, null);
		medDialog.force_close();
		DosageWindow._scheduleNotifications('saving');
	});

	addSaveKeyControllerToDialog(medDialog, saveButton);

	let updatedItemPosition = 0;
	function addOrUpdateTreatment() {
		const isUpdate = list && position >= 0 && !mode;
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
			monthDay,
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
		monthDay = dayOfMonth.value;
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
		if (frequencyMenu.get_selected() === 2) freq = 'day-of-month';
		if (frequencyMenu.get_selected() === 3) freq = 'cycle';
		if (frequencyMenu.get_selected() === 4) freq = 'when-needed';

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
				const lastTk = item.dosage.find(
					itDose => itDose.time[0] === dose.time[0] && itDose.time[1] === dose.time[1],
				)?.lastTaken;

				return {
					time: dose.time,
					dose: dose.dose,
					lastTaken: lastTk || null,
				};
			});
			treatmentsLS.remove(position);
		} else {
			doses.forEach(dose => {
				dose.lastTaken = null;
			});
		}

		const newIt = new MedicationObject({
			obj: {
				name: name,
				unit: unit,
				notes: notes,
				frequency: freq,
				color: color,
				icon: icon,
				days: days,
				monthDay: monthDay,
				cycle: cycle,
				dosage: doses,
				recurring: recurring,
				inventory: inventory,
				duration: duration,
			},
		});

		treatmentsLS.insert_sorted(newIt, (a, b) => {
			const name1 = a.obj.name;
			const name2 = b.obj.name;
			return name1.localeCompare(name2);
		});

		updatedItemPosition = treatmentsLS.find(newIt)[1];
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
		let day = firstWeekday;

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
		let day = firstWeekday;

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

	function handleDayOfMonthLabels() {
		frequencyMenu.title = _('Day of the month');
		frequencyMenu.subtitle = _('Day') + `: ${dayOfMonth.value}`;
	}

	function handleCycle() {
		const sum = cycleActive.value + cycleInactive.value;
		frequencyMenu.subtitle = cycleActive.value + ' ⊷ ' + cycleInactive.value;
		cycleCurrent.adjustment.set_upper(sum);
		if (cycleCurrent.adjustment.value > sum) {
			cycleCurrent.adjustment.value = sum;
		}
	}

	function setFreqMenuVisibility(item) {
		const freqRowPrefixes = frequencyMenu.get_first_child().get_first_child();
		const selected = frequencyMenu.get_selected();
		freqRowPrefixes.set_visible(selected !== 0 && selected !== 4);

		frequencyMenu.connect('notify::selected-item', frequencyMenu => {
			const selected = frequencyMenu.get_selected();
			freqRowPrefixes.set_visible(selected !== 0 && selected !== 4);
			frequencySpecificDays.set_visible(selected === 1);
			frequencyDayOfMonth.set_visible(selected === 2);
			frequencyCycle.set_visible(selected === 3);

			if (selected === 1) {
				frequencyMenu.title = _('Specific days');
				setSpecificDaysFreqLabel();
			} else if (selected === 2) {
				handleDayOfMonthLabels();
			} else if (selected === 3) {
				frequencyMenu.title = _('Cycle');
				handleCycle();
			} else {
				frequencyMenu.title = _('Frequency');
			}

			if (selected !== 4) {
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
			if (item.frequency === 'day-of-month') frequencyMenu.set_selected(2);
			if (item.frequency === 'cycle') frequencyMenu.set_selected(3);
			if (item.frequency === 'when-needed') frequencyMenu.set_selected(4);
		}
	}

	function isValidInput(isUpdate) {
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
				toastOverlay.add_toast(new Adw.Toast({ title: _('Name already on treatment list') }));
				medName.add_css_class('error');
				return;
			}
		}

		let currentDoseRow = listRows.get_first_child();
		const rows = [];

		while (currentDoseRow) {
			const [hours, minutes, timeBtn] = getTimeBtnInput(currentDoseRow);
			const time = String([hours, minutes]);

			if (rows.includes(time)) {
				toastOverlay.add_toast(new Adw.Toast({ title: _('Duplicated time') }));
				(async function () {
					timeBtn.add_css_class('time-error');
					await new Promise(res => setTimeout(res, 1400));
					timeBtn.remove_css_class('time-error');
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

export function confirmDeleteDialog(item, position, DosageWindow, medDialog) {
	const alertDialog = new Adw.AlertDialog({
		// TRANSLATORS: Message for confirmation when deleting an item
		heading: _('Are you sure?'),
		body: `"${item.name}" ` + _('will be deleted'),
	});

	alertDialog.add_response('cancel', _('Cancel'));
	alertDialog.add_response('delete', _('Delete'));
	alertDialog.set_response_appearance('delete', Adw.ResponseAppearance.DESTRUCTIVE);

	// artificial delay to avoid opening multiple dialogs
	// when double clicking button
	if (!flow.delay) {
		if (medDialog) {
			alertDialog.present(medDialog);
		} else {
			alertDialog.present(DosageWindow);
		}
		flow.delay = true;
		setTimeout(() => {
			flow.delay = false;
		}, 500);
	}

	alertDialog.connect('response', (_self, response) => {
		if (response === 'delete') {
			const it = DosageWindow._treatmentsList.model.get_item(position);
			const deletePos = treatmentsLS.find(it)[1];
			treatmentsLS.remove(deletePos);
			if (medDialog) medDialog.force_close();
			DosageWindow._updateEverything('skipHistUp', null, 'skipCycleUp');
			DosageWindow._scheduleNotifications('deleting');
			DosageWindow._treatmentsList.scroll_to(
				Math.max(0, position - 1),
				Gtk.ListScrollFlags.FOCUS,
				null,
			);
		}
	});
}
