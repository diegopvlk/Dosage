'use strict';

import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';

export const todayHeaderFactory = new Gtk.SignalListItemFactory();
export const todayItemFactory = new Gtk.SignalListItemFactory();

todayHeaderFactory.connect('setup', (factory, listHeaderItem) => {
	const timeLabel = new Gtk.Label({
		halign: Gtk.Align.START,
		margin_bottom: 1,
	});
	listHeaderItem.set_child(timeLabel);
});

todayHeaderFactory.connect('bind', (factory, listHeaderItem) => {
	const item = listHeaderItem.get_item();
	const timeLabel = listHeaderItem.get_child();

	let [hours, minutes] = item.info.dosage.time;
	let period = '';

	if (clockIs12) {
		period = ' AM';
		if (hours >= 12) period = ' PM';
		if (hours > 12) hours -= 12;
		if (hours === 0) hours = 12;
	}

	const h = String(hours).padStart(2, 0);
	const m = String(minutes).padStart(2, 0);

	timeLabel.label = `${h}∶${m}` + period;
});

todayItemFactory.connect('setup', (factory, listItem) => {
	const box = new Gtk.Box({
		css_classes: ['card'],
		height_request: 64,
	});
	const stripe = new Gtk.Box({
		css_classes: ['card-stripe'],
		height_request: 64,
		width_request: 6,
	});
	box.append(stripe);
	const icon = new Gtk.Image({
		margin_start: 12,
		margin_end: 6,
		icon_name: 'pill-symbolic',
	});
	box.append(icon);
	const labelsBox = new Gtk.Box({
		valign: Gtk.Align.CENTER,
		hexpand: true,
		orientation: Gtk.Orientation.VERTICAL,
		margin_start: 8,
		margin_end: 12,
	});
	box.append(labelsBox);
	const name = new Gtk.Label({
		halign: Gtk.Align.START,
		margin_bottom: 1,
	});
	labelsBox.append(name);
	const doseAndNotes = new Gtk.Label({
		css_classes: ['subtitle'],
		halign: Gtk.Align.START,
		ellipsize: Pango.EllipsizeMode.END,
	});
	labelsBox.append(doseAndNotes);
	const checkButton = new Gtk.CheckButton({
		css_classes: ['flat', 'circular', 'selection-mode'],
		valign: Gtk.Align.CENTER,
		halign: Gtk.Align.CENTER,
		margin_end: 12,
		can_focus: false,
		can_target: false,
	});
	box.append(checkButton);
	listItem.set_child(box);
});

todayItemFactory.connect('bind', (factory, listItem) => {
	const item = listItem.get_item();
	const box = listItem.get_child();
	const row = box.get_parent();
	const icon = box.get_first_child().get_next_sibling();
	const labelsBox = icon.get_next_sibling();
	const nameLabel = labelsBox.get_first_child();
	const doseLabel = nameLabel.get_next_sibling();

	// activate item with space bar
	const keyController = new Gtk.EventControllerKey();
	keyController.connect('key-pressed', (_, keyval, keycode, state) => {
		if (keyval === Gdk.KEY_space) {
			let listView = row.get_parent();
			listView.emit('activate', listItem.position);
		}
	});
	row.add_controller(keyController);

	row.remove_css_class('activatable');
	box.add_css_class('activatable');

	const colors = [
		'default', 'red', 'orange', 'yellow',
		'green', 'cyan', 'blue', 'purple'
	];
	colors.forEach(c => box.remove_css_class(c));
	
	box.add_css_class(item.info.color);

	nameLabel.label = item.name;
	doseLabel.label = `${item.info.dosage.dose} ${item.unit}`;

	if (item.info.notes !== '') {
		doseLabel.label += `  •  ${item.info.notes}`;
	}

	icon.icon_name = item.info.icon;
});
