/*
 * Copyright 2023 Diego Povliuk
 * SPDX-License-Identifier: GPL-3.0-only
 */
'use strict';

import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';
import { DosageApplication } from './main.js';
import { timeFormat } from './utils.js';

export const todayHeaderFactory = new Gtk.SignalListItemFactory();
export const todayItemFactory = new Gtk.SignalListItemFactory();

todayHeaderFactory.connect('setup', (factory, listHeader) => {
	listHeader.box = new Gtk.Box({
		hexpand: true,
	});

	listHeader.selectTimeGroupBtn = new Gtk.Button({
		css_classes: ['time-group-selection', 'flat'],
		valign: Gtk.Align.START,
	});

	listHeader.whenNeededLabel = new Gtk.Label({
		halign: Gtk.Align.START,
		ellipsize: Pango.EllipsizeMode.END,
		opacity: 0.75,
		label: _('When necessary'),
	});

	listHeader.pinIcon = new Gtk.Image({
		icon_name: 'pin-symbolic',
		opacity: 0.75,
		margin_start: 4,
	});

	listHeader.box.append(listHeader.selectTimeGroupBtn);
	listHeader.box.append(listHeader.whenNeededLabel);
	listHeader.box.append(listHeader.pinIcon);
	listHeader.set_child(listHeader.box);
});

todayHeaderFactory.connect('bind', (factory, listHeader) => {
	const item = listHeader.item.obj;
	const selectTimeGroupBtn = listHeader.selectTimeGroupBtn;
	const isWhenNd = item.frequency === 'when-needed';

	listHeader.whenNeededLabel.visible = isWhenNd;
	listHeader.pinIcon.visible = isWhenNd;
	listHeader.selectTimeGroupBtn.visible = !isWhenNd;

	const itemTime = GLib.DateTime.new_local(1, 1, 1, item.time[0], item.time[1], 1);
	const time = itemTime.format(timeFormat);

	selectTimeGroupBtn.connect('clicked', _btn => {
		const DW = DosageApplication.get_default().activeWindow;

		const start = listHeader.start;
		const end = listHeader.end;

		for (let pos = start; pos < end; pos++) {
			DW.selectTodayItems(DW._todayList, pos, true);
		}
	});

	selectTimeGroupBtn.label = time;
});

todayItemFactory.connect('setup', (factory, listItem) => {
	listItem.box = new Gtk.Box();

	listItem.icon = new Gtk.Image({
		margin_start: 17,
		margin_end: 4,
		icon_name: 'pill-symbolic',
	});

	listItem.box.append(listItem.icon);

	listItem.labelsBox = new Gtk.Box({
		valign: Gtk.Align.CENTER,
		hexpand: true,
		orientation: Gtk.Orientation.VERTICAL,
		margin_start: 9,
		margin_end: 12,
	});

	listItem.box.append(listItem.labelsBox);

	listItem.nameLabel = new Gtk.Label({
		css_classes: ['title'],
		halign: Gtk.Align.START,
		ellipsize: Pango.EllipsizeMode.END,
		margin_bottom: 1,
	});

	listItem.labelsBox.append(listItem.nameLabel);

	listItem.doseAndNotes = new Gtk.Label({
		css_classes: ['subtitle'],
		halign: Gtk.Align.START,
		ellipsize: Pango.EllipsizeMode.END,
	});

	listItem.labelsBox.append(listItem.doseAndNotes);

	listItem.amountBox = new Gtk.Box({
		css_classes: ['spin-box', 'spin-today-amount'],
	});

	listItem.amtSpinRow = new Adw.SpinRow({
		digits: 2,
		adjustment: new Gtk.Adjustment({
			lower: 0.25,
			upper: 9999,
			step_increment: 0.25,
		}),
	});

	listItem.amountBox.append(listItem.amtSpinRow);

	listItem.amountBtn = new Gtk.MenuButton({
		tooltip_text: _('Change dose'),
		css_classes: ['circular', 'today-amount'],
		icon_name: 'view-more-horizontal-symbolic',
		valign: Gtk.Align.CENTER,
		halign: Gtk.Align.CENTER,
		margin_end: 10,
		visible: false,
		popover: new Gtk.Popover({
			css_classes: ['menu', 'popover-scrolled'],
			child: new Gtk.ScrolledWindow({
				propagate_natural_height: true,
				propagate_natural_width: true,
				child: listItem.amountBox,
			}),
		}),
	});

	listItem.box.append(listItem.amountBtn);

	listItem.checkButton = new Gtk.CheckButton({
		css_classes: ['selection-mode'],
		valign: Gtk.Align.CENTER,
		halign: Gtk.Align.CENTER,
		margin_end: 11,
		can_focus: false,
		can_target: false,
	});

	listItem.signal = listItem.connect('notify::selected', () => {
		listItem.checkButton.active = listItem.selected;
	});

	listItem.box.append(listItem.checkButton);

	listItem.selectable = false;

	listItem.set_child(listItem.box);

	listItem.keyController = new Gtk.EventControllerKey();

	// activate item with space bar
	listItem.keyController.connect('key-pressed', (_, keyval, keycode, state) => {
		if (keyval === Gdk.KEY_space) {
			const row = listItem.box.parent;
			const listView = row.parent;
			listView.emit('activate', listItem.position);
		}
	});

	listItem.controllerAndSignals = false;
});

todayItemFactory.connect('bind', (factory, listItem) => {
	const item = listItem.item.obj;
	const box = listItem.box;
	const row = box.parent;
	const icon = listItem.icon;
	const amountBtn = listItem.amountBtn;
	const amtSpinRow = listItem.amtSpinRow;
	const name = listItem.nameLabel;
	const doseAndNotes = listItem.doseAndNotes;

	if (!listItem.controllerAndSignals) {
		row.add_controller(listItem.keyController);

		listItem.checkButton.connect('toggled', btn => {
			amountBtn.visible = btn.active;
			btn.active = listItem.selected;
			listItem.checkButton.active = listItem.selected;
		});

		amtSpinRow.connect('output', row => {
			item.dose = row.value;
			listItem.setDoseAndNotes();
		});

		amountBtn.connect('notify::visible', btn => {
			if (!btn.visible) {
				item.dose = item.originalDose;
				listItem.setDoseAndNotes();
			}
		});

		row.connect('unrealize', () => {
			listItem.disconnect(listItem.signal);
		});

		listItem.setDoseAndNotes = () => {
			doseAndNotes.label = `${item.dose} ${item.unit}`;
			if (item.notes !== '') {
				doseAndNotes.label += ` • ${item.notes}`;
			}
		};

		listItem.controllerAndSignals = true;
	}

	name.label = item.name;

	listItem.setDoseAndNotes();

	amtSpinRow.set_value(item.dose);

	icon.icon_name = item.icon;
	box.css_classes = ['item-box', 'card-stripe', item.color];

	if (item.frequency === 'when-needed') {
		box.css_classes = ['item-box', 'card-stripe-w-n', item.color];
		box.opacity = 0.75;
	} else {
		box.css_classes = ['item-box', 'card-stripe', item.color];
		box.opacity = 1;
	}
});
