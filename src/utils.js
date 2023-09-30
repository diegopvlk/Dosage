import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

export const DataDir = Gio.file_new_for_path(
	GLib.build_filenamev([GLib.get_user_data_dir()])
);

export function addLeadZero(input) {
	return String(input).padStart(2, 0);
}

export function createTempFile(listStore) {
	const tempFile = { meds: [] };
	for (const item of listStore) {
		const tempObj = { ...item };
		tempFile.meds.push(tempObj);
	}
	return tempFile;
}

export function formatDate(date, utc) {
	let day = date.getDate();
	let month = date.getMonth() + 1;
	let year = date.getFullYear();

	return `${year}-${addLeadZero(month)}-${addLeadZero(day)}`;
}

export function handleCalendarSelect(calendarWidget, calendarBtn) {
	const today = GLib.DateTime.new_now_local().format('%F');
	calendarWidget.connect('day-selected', () => {
		const selectedDate = calendarWidget.get_date().format('%F');
		calendarBtn.label = calendarWidget.get_date().format('%x');
		if (selectedDate >= today) {
			calendarWidget.remove_css_class('calendar-error');
		} else {
			calendarWidget.add_css_class('calendar-error');
		}
	});
}

export function isMedDay(item, compareDt, loadToday, histModel) {
	const info = item.info;
	const oneDay = 86400000; // one day in milliseconds
	const startDate = new Date(info.duration.start * 1000);
	const endDate = new Date(info.duration.end * 1000);
	const compareDate = new Date(compareDt).getTime();
	const timeDiff = compareDate - startDate;
	const daysSinceStart = Math.floor(timeDiff / oneDay);
	const today = formatDate(new Date());

	if (info.duration.enabled) {
		const start = formatDate(startDate);
		const end = formatDate(endDate);

		if (start > today || end < today) {
			return false;
		}
	}

	if (loadToday) {
		const histNotEmpty = histModel.get_n_items() > 0;
		const lastSectionAmount = histModel.get_section(0)[1];

		if (histNotEmpty) {
			for (let i = 0; i < lastSectionAmount; i++) {
				const name = histModel.get_item(i).name;
				const time = histModel.get_item(i).info.time;
				const histDt = new Date(histModel.get_item(i).date);
				const date = formatDate(histDt);

				if (date === today && item.name === name) {
					if (String(info.dosage.time) == String(time)) 
						return false;
				}
			}
		}
	}
	
	if (info.frequency === 'daily') {
		return true;
	}
	else if (info.frequency === 'specific-days') {
		let todayOfWeek = new Date().getDay();
		if (!loadToday) todayOfWeek = compareDt.getDay();

		const isToday = info.days.includes(todayOfWeek);

		return isToday ? true : false;
	} 
	else if (info.frequency === 'cycle') {
		const [active, inactive, current] = info.cycle;
		const totalCycleDays = active + inactive;
		const currentCycleDay =
			((daysSinceStart + current - 1) % totalCycleDays) + 1;

		return currentCycleDay <= active ? true : false;
	} 
	else if (info.frequency === 'when-needed') {
		return false;
	}
}

export function dateDifference(startDate, endDate) {
	const oneDay = 86400000;
	const start = new Date(startDate);
	const end = new Date(endDate);
	// const timeDifference = Math.abs(end - start);
	const timeDifference = end - start;
	const daysDifference = Math.floor(timeDifference / oneDay); // number of days
	const datesPassed = [];

	for (let i = 0; i <= daysDifference; i++) {
		const currentDate = new Date(startDate);
		currentDate.setDate(currentDate.getDate() + i);
		datesPassed.push(currentDate);
	}

	return datesPassed;
}

export function doseRow(info) {
	let [hours, minutes] = info.time;
	let period = '';

	if (clockIs12) {
		period = hours < 12 ? 'AM' : 'PM';
		if (hours > 12) hours -= 12;
		if (hours === 0) hours = 12;
	}

	const doseRow = new Adw.SpinRow({
		climb_rate: 0.2,
		digits: 2,
		adjustment: new Gtk.Adjustment({
			lower: 0.25,
			upper: 999,
			step_increment: 0.25,
			value: info.dose,
		}),
	});
	const doseBox = new Gtk.Box();
	const removeDoseButton = new Gtk.Button({
		css_classes: ['circular', 'destructive-action', 'remove-row'],
		opacity: 0.85,
		valign: Gtk.Align.CENTER,
		margin_end: 4,
		icon_name: 'user-trash-symbolic',
		tooltip_text: _('Delete dose'),
	});
	const doseTimeBox = new Gtk.Box({
		css_classes: ['time-box'],
	});
	const adjustmentHours = new Gtk.Adjustment({
		lower: 0,
		upper: 23,
		step_increment: 1,
		value: hours,
	});
	const spinButtonHours = new Gtk.SpinButton({
		orientation: Gtk.Orientation.VERTICAL,
		valign: Gtk.Align.CENTER,
		numeric: true,
		wrap: true,
		adjustment: adjustmentHours,
	});
	const adjustmentMinutes = new Gtk.Adjustment({
		lower: 0,
		upper: 59,
		step_increment: 5,
		value: minutes,
	});
	const spinButtonMinutes = new Gtk.SpinButton({
		orientation: Gtk.Orientation.VERTICAL,
		valign: Gtk.Align.CENTER,
		numeric: true,
		wrap: true,
		adjustment: adjustmentMinutes,
	});
	const spinButtonSeparator = new Gtk.Label({
		label: ' : ',
	});

	doseTimeBox.append(spinButtonHours);
	doseTimeBox.append(spinButtonSeparator);
	doseTimeBox.append(spinButtonMinutes);

	const leadingZeroHours = addLeadZero(adjustmentHours.value);
	const leadingZeroMinutes = addLeadZero(adjustmentMinutes.value);
	const doseTimeButton = new Gtk.MenuButton({
		css_classes: ['flat', 'numeric', 'time'],
		label: `${leadingZeroHours}∶${leadingZeroMinutes}`,
		valign: Gtk.Align.CENTER,
		popover: new Gtk.Popover({
			child: doseTimeBox,
		}),
	});

	spinButtonHours.connect('output', (h) => {
		spinButtonHours.text = addLeadZero(h.adjustment.value);
		doseTimeButton.label = `${spinButtonHours.text}∶${spinButtonMinutes.text}`;
		return true;
	});
	spinButtonMinutes.connect('output', (m) => {
		spinButtonMinutes.text = addLeadZero(m.adjustment.value);
		doseTimeButton.label = `${spinButtonHours.text}∶${spinButtonMinutes.text}`;
		return true;
	});

	const amPmButton = new Gtk.Button({
		css_classes: ['am-pm', 'circular', 'flat'],
		valign: Gtk.Align.CENTER,
		label: period,
		visible: clockIs12,
	});
	amPmButton.connect('clicked', (btn) => {
		btn.label = btn.label === 'AM' ? 'PM' : 'AM';
	});

	if (clockIs12) {
		adjustmentHours.lower = 1;
		adjustmentHours.upper = 12;
	}

	doseBox.append(removeDoseButton);
	doseBox.append(doseTimeButton);
	doseBox.append(amPmButton);
	doseRow.add_prefix(doseBox);

	doseRow.add_css_class('ampm-row');

	removeDoseButton.connect('clicked', (btn) => {
		removeRow(doseRow);
	});

	return doseRow;
}

export function getTimeBtnInput(currentDoseRow) {
	// TODO: need a better way to get these widgets
	const timeButton = currentDoseRow
		.get_first_child()
		.get_first_child()
		.get_first_child()
		.get_first_child()
		.get_next_sibling();
	const hourInput = timeButton
		.get_popover()
		.get_first_child()
		.get_first_child()
		.get_first_child();
	const minutesInput = timeButton
		.get_popover()
		.get_first_child()
		.get_first_child()
		.get_last_child();

	const ampm = timeButton.get_next_sibling();
	const period = ampm.label;

	let hours = hourInput.get_value();
	let minutes = minutesInput.get_value();

	// The time is stored in 24h format
	if (clockIs12) {
		if (period === 'AM' && hours === 12) hours = 0;
		if (period === 'PM' && hours !== 12) hours += 12;
	}

	return [hours, minutes, ampm, timeButton];
}

export const HistorySectionSorter = GObject.registerClass(
{},	class HistorySectionSorter extends Gtk.Sorter {
		_init(params) {	super._init(params); }

		vfunc_compare(obj1, obj2) {
			const dt1 = formatDate(new Date(obj1.date));
			const dt2 = formatDate(new Date(obj2.date));

			return dt1 === dt2 ? 0 : dt1 < dt2 ? 1 : -1;
		}
	}
);

export const HistorySorter = GObject.registerClass(
{},	class HistorySorter extends Gtk.Sorter {
		_init(params) {	super._init(params); }

		vfunc_compare(obj1, obj2) {
			return obj1.date > obj2.date ? -1 : 0;
		}
	}
);

export const TodaySectionSorter = GObject.registerClass(
{},	class TodaySectionSorter extends Gtk.Sorter {
		_init(params) { super._init(params); }

		vfunc_compare(obj1, obj2) {
			const [h1, m1] = obj1.info.dosage.time;
			const [h2, m2] = obj2.info.dosage.time;

			const hm1 = `${addLeadZero(h1)}:${addLeadZero(m1)}`;
			const hm2 = `${addLeadZero(h2)}:${addLeadZero(m2)}`;

			return hm1 === hm2 ? 0 : hm1 > hm2 ? 1 : -1;
		}
	}
);
