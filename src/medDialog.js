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
	handleCalendarSelect,
	getDayLabel,
	firstWeekday,
	getSpecificDaysLabel,
	addSaveKeyControllerToDialog,
} from './utils.js';

import { MedicationObject } from './medication.js';
import { treatmentsLS } from './window.js';

import { TimeDoseRow } from './timeDoseRow.js';

const frequencies = ['daily', 'specific-days', 'day-of-month', 'cycle', 'when-needed'];

export let dosageList;

export function openMedicationDialog(DosageWindow, list, position, duplicate) {
	const builder = Gtk.Builder.new_from_resource('/io/github/diegopvlk/Dosage/ui/med-dialog.ui');

	const toastOverlay = builder.get_object('toastOverlay');
	const toast = new Adw.Toast();
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
			const cssClasses = [clr.get_name() + '-clr', 'circular'];
			dosageColorButton.set_css_classes(cssClasses);
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

	dosageList = builder.get_object('dosageList');

	const markAsConfirmed = builder.get_object('markAsConfirmed');

	const increasePriority = builder.get_object('increasePriority');

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
	const existingTreatment = (list && position >= 0) || duplicate;
	if (existingTreatment) {
		if (!duplicate) {
			medDialog.title = _('Edit treatment');
			saveButton.label = _('Save');
			deleteButton.set_visible(true);
		}

		medDialog.set_presentation_mode(0);

		const item = list.get_model().get_item(position).obj;

		medName.text = item.name;
		medUnit.text = item.unit;
		medNotes.text = item.notes ? item.notes : '';

		if (duplicate) {
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

		item.dosage.forEach(timeDose => {
			const timeDoseRow = new TimeDoseRow(timeDose);
			dosageList.append(timeDoseRow.spinRow);
		});

		setFreqMenuVisibility(item);
		if (item.frequency === 'specific-days') {
			frequencyMenu.subtitle = getSpecificDaysLabel(item);
		}

		if (item.markConfirmed) {
			markAsConfirmed.active = true;
		}

		if (item.notification.increasePriority) {
			increasePriority.active = true;
		}

		if (item.notification.recurring) {
			recurringNotif.set_enable_expansion(item.notification.recurring.enabled);
			recurringInterval.value = item.notification.recurring.interval;
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
			const start = GLib.DateTime.new_from_unix_local(item.duration.start / 1000);
			const end = GLib.DateTime.new_from_unix_local(item.duration.end / 1000);
			calendarStart.select_day(start);
			calendarEnd.select_day(end);
		}

		deleteButton.connect('activated', () => {
			confirmDeleteDialog(item, position, DosageWindow, medDialog);
		});
	} else {
		const timeDoseRow = new TimeDoseRow({ time: [12, 30], dose: 1 });
		dosageList.append(timeDoseRow.spinRow);
		setFreqMenuVisibility();
	}

	const addDoseBtn = new Gtk.Button({
		css_classes: ['circular', 'suggested-action'],
		valign: Gtk.Align.CENTER,
		margin_end: 3,
		icon_name: 'list-add-symbolic',
		tooltip_text: _('Add dose'),
	});

	addDoseBtn.connect('clicked', () => {
		const lastRow = dosageList.get_last_child();
		let h = lastRow.hours;
		const m = lastRow.minutes;
		const d = lastRow.value;
		const timeDoseRow = new TimeDoseRow({ time: [++h, m], dose: d });
		dosageList.append(timeDoseRow.spinRow);
	});

	dosageList.get_first_child().prefix.prepend(addDoseBtn);

	dayOfMonth.connect('output', handleDayOfMonthLabels);

	cycleActive.connect('output', handleCycle);
	cycleInactive.connect('output', handleCycle);

	for (const button of specificDaysBox) {
		button.connect('toggled', setSpecificDaysFreqLabel);
	}

	setSpecificDaysButtonOrder();

	addSaveKeyControllerToDialog(medDialog, saveButton);

	const medDialogClamp = builder.get_object('medDialogClamp');
	const [medDialogClampHeight] = medDialogClamp.measure(Gtk.Orientation.VERTICAL, -1);
	medDialog.content_height = medDialogClampHeight + 48;
	medDialog.present(DosageWindow);

	cancelButton.connect('clicked', () => medDialog.force_close());

	saveButton.connect('clicked', () => {
		const isUpdate = list && position >= 0 && !duplicate;

		if (!isValidInput(isUpdate)) return;

		addOrUpdateTreatment();
		DosageWindow.updateEverything({ skipHistUp: true });
		const pos = Math.max(0, updatedItemPosition - 1);
		DosageWindow._treatmentsList.scroll_to(pos, Gtk.ListScrollFlags.FOCUS, null);
		medDialog.force_close();
		DosageWindow.scheduleNotifications('saving');
	});

	let updatedItemPosition = 0;
	function addOrUpdateTreatment() {
		const isUpdate = list && position >= 0 && !duplicate;
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
			frequency,
			monthDay,
			icon,
			markConfirmed,
			notification,
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
		markConfirmed = markAsConfirmed.get_active();
		notification = { recurring: {} };
		notification.increasePriority = increasePriority.get_active();
		notification.recurring.enabled = recurringNotif.get_enable_expansion();
		notification.recurring.interval = recurringInterval.get_value();
		cycle[0] = cycleActive.adjustment.value;
		cycle[1] = cycleInactive.adjustment.value;
		cycle[2] = cycleCurrent.adjustment.value;
		color = dosageColorButton.get_name();
		icon = dosageIconButton.get_icon_name().replace('-symbolic', '');
		current = medCurrrentInv.value;
		reminder = medReminderInv.value;
		inventory = { enabled: invEnabled, current: current, reminder: reminder };
		duration = { enabled: durEnabled, start: start, end: end };

		frequency = frequencies[frequencyMenu.get_selected()];

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
				frequency: frequency,
				color: color,
				icon: icon,
				days: days,
				monthDay: monthDay,
				cycle: cycle,
				dosage: doses,
				notification: notification,
				inventory: inventory,
				duration: duration,
				markConfirmed: markConfirmed,
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
		let currRow = dosageList.get_first_child();

		while (currRow) {
			const ds = {
				time: [currRow.hours, currRow.minutes],
				dose: currRow.value,
			};
			doses.push(ds);
			currRow = currRow.get_next_sibling();
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
		const freqRowPrefix = frequencyMenu.get_first_child().get_first_child();
		const selected = frequencyMenu.get_selected();
		freqRowPrefix.visible = selected !== 0 && selected !== 4;

		frequencyMenu.connect('notify::selected-item', frequencyMenu => {
			const selected = frequencyMenu.get_selected();

			freqRowPrefix.visible = selected !== 0 && selected !== 4;
			frequencySpecificDays.visible = selected === 1;
			frequencyDayOfMonth.visible = selected === 2;
			frequencyCycle.visible = selected === 3;

			switch (selected) {
				case 1:
					frequencyMenu.title = _('Specific days');
					setSpecificDaysFreqLabel();
					break;
				case 2:
					handleDayOfMonthLabels();
					break;
				case 3:
					frequencyMenu.title = _('Cycle');
					handleCycle();
					break;
				default:
					frequencyMenu.title = _('Frequency');
			}

			// if when-needed is selected, hide mark confirmed, priority, duration and recurring
			markAsConfirmed.visible = selected !== 4;
			increasePriority.visible = selected !== 4;
			medDuration.visible = selected !== 4;
			recurringNotif.visible = selected !== 4;

			let currRow = dosageList.get_first_child();

			while (currRow) {
				currRow.prefix.sensitive = selected !== 4;
				currRow.visible = selected !== 4 || currRow === dosageList.get_first_child();
				currRow = currRow.get_next_sibling();
			}
		});

		if (item) {
			const selectedIndex = frequencies.indexOf(item.frequency);
			frequencyMenu.set_selected(selectedIndex);
		}
	}

	function isValidInput(isUpdate) {
		medName.connect('changed', name => name.remove_css_class('error'));
		medUnit.connect('changed', unit => unit.remove_css_class('error'));

		const emptyName = medName.text.trim() == '';
		const emptyUnit = medUnit.text.trim() == '';

		if (emptyName) {
			toast.dismiss();
			toast.title = _('Empty name');
			toastOverlay.add_toast(toast);
			medName.add_css_class('error');
			return;
		} else if (emptyUnit) {
			toast.dismiss();
			toast.title = _('Empty unit');
			toastOverlay.add_toast(toast);
			medUnit.add_css_class('error');
			return;
		}

		if (frequencySpecificDays.get_visible() && getSpecificDays().length == 0) {
			toast.title = _('Choose at least one day');
			toast.dismiss();
			toastOverlay.add_toast(toast);
			return;
		}

		for (const it of treatmentsLS) {
			const i = it.obj;
			if (isUpdate) {
				const item = list.get_model().get_item(position).obj;
				if (i === item) continue;
			}
			if (i.name.toLowerCase() === medName.text.trim().toLowerCase()) {
				toast.dismiss();
				toast.title = _('Name already on treatment list');
				toastOverlay.add_toast(toast);
				medName.add_css_class('error');
				return;
			}
		}

		let currRow = dosageList.get_first_child();
		const rows = [];

		while (currRow) {
			const time = String([currRow.hours, currRow.minutes]);

			if (rows.includes(time)) {
				toast.dismiss();
				toast.title = _('Duplicated time');
				toastOverlay.add_toast(toast);
				return;
			} else {
				rows.push(time);
			}

			currRow = currRow.get_next_sibling();
		}
		return true;
	}
}

export function confirmDeleteDialog(item, position, DosageWindow, medDialog) {
	const alertDialog = new Adw.AlertDialog({
		body_use_markup: true,
		heading: _('Are you sure?'),
		body: `<b>${item.name}</b> ` + _('will be deleted'),
	});

	alertDialog.add_response('cancel', _('Cancel'));
	alertDialog.add_response('delete', _('Delete'));
	alertDialog.set_response_appearance('delete', Adw.ResponseAppearance.DESTRUCTIVE);

	if (medDialog) {
		alertDialog.present(medDialog);
	} else {
		alertDialog.present(DosageWindow);
	}

	alertDialog.connect('response', (_self, response) => {
		if (response === 'delete') {
			const it = DosageWindow._treatmentsList.model.get_item(position);
			const deletePos = treatmentsLS.find(it)[1];
			treatmentsLS.remove(deletePos);
			if (medDialog) medDialog.force_close();
			DosageWindow.updateEverything({ skipHistUp: true, skipCycleUp: true });
			DosageWindow.scheduleNotifications('deleting');
			DosageWindow._treatmentsList.scroll_to(
				Math.max(0, position - 1),
				Gtk.ListScrollFlags.FOCUS,
				null,
			);
		}
	});
}
