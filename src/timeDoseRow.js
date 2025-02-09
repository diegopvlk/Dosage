'use strict';

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk';
import TimePicker from './timePicker.js';
import { dosageList } from './medDialog.js';

export class TimeDoseRow {
	constructor(timeDose) {
		let [hours, minutes] = timeDose.time;

		this.spinRow = new Adw.SpinRow({
			climb_rate: 0.2,
			digits: 2,
			adjustment: new Gtk.Adjustment({
				lower: 0.25,
				upper: 9999,
				step_increment: 0.25,
				value: timeDose.dose,
			}),
		});
		this.spinRow.add_css_class('t-d-row');

		this.date = new Date();
		this.date.setHours(hours);
		this.date.setMinutes(minutes);
		this.timePicker = new TimePicker(this.date);

		this.removeDoseBtn = new Gtk.Button({
			css_classes: ['circular', 'destructive-action'],
			valign: Gtk.Align.CENTER,
			margin_end: 3,
			icon_name: 'user-trash-symbolic',
			tooltip_text: _('Delete dose'),
		});

		this.timeBtn = new Gtk.MenuButton({
			can_shrink: true,
			css_classes: ['flat', 'numeric'],
			label: this.timePicker.entry.text,
			valign: Gtk.Align.CENTER,
			halign: Gtk.Align.START,
			popover: new Gtk.Popover({
				child: new Gtk.ScrolledWindow({
					propagate_natural_height: true,
					propagate_natural_width: true,
					child: this.timePicker,
				}),
			}),
		});

		this.spinRow.hours = this.timePicker.hours;
		this.spinRow.minutes = this.timePicker.minutes;
		this.spinRow.timeBtn = this.timeBtn;

		this.timePicker.entry.connect('changed', e => {
			this.timeBtn.label = e.text;
			this.spinRow.hours = this.timePicker.hours;
			this.spinRow.minutes = this.timePicker.minutes;
		});

		this.spinRow.prefix = new Gtk.Box({});

		if (dosageList.get_first_child()) {
			this.spinRow.prefix.append(this.removeDoseBtn);
		}

		this.spinRow.prefix.append(this.timeBtn);
		this.spinRow.add_prefix(this.spinRow.prefix);

		this.removeDoseBtn.connect('clicked', () => {
			dosageList.remove(this.spinRow);
		});
	}
}
