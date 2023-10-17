/*
 * Copyright 2023 Diego Povliuk
 * SPDX-License-Identifier: GPL-3.0-only
 */
'use strict';

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';

import { Medication, HistoryMedication, TodayMedication } from './medication.js';
import { todayHeaderFactory, todayItemFactory } from './todayFactory.js';
import { historyHeaderFactory, historyItemFactory } from './historyFactory.js';
import { treatmentsFactory } from './treatmentsFactory.js';

import {
	HistorySorter, HistorySectionSorter, TodaySectionSorter,
	DataDir, addLeadZero, doseRow, getTimeBtnInput, formatDate,
	createTempFile, handleCalendarSelect, isTodayMedDay,
	datesPassedDiff, removeCssColors
} from './utils.js';

const historyLS = Gio.ListStore.new(HistoryMedication);
const treatmentsLS = Gio.ListStore.new(Medication);

export const DosageWindow = GObject.registerClass({
	GTypeName: 'DosageWindow',
	Template: 'resource:///io/github/diegopvlk/Dosage/ui/window.ui',
	InternalChildren: [
		'todayList', 'historyList', 'treatmentsList', 'treatmentsPage',
		'skipBtn', 'entryBtn', 'unselectBtn', 
		'emptyToday', 'emptyHistory', 'emptyTreatments'
	],
},
class DosageWindow extends Adw.ApplicationWindow {
	constructor(application) {
		super({ application });
		this.#loadSettings();
		this.#checkClockFormat();
		this.#start();
		this.#checkInventory();
		this.#scheduleNextMidnight();
	}

	#loadSettings() {
		const appId = this.get_application().applicationId;
		globalThis.settings = new Gio.Settings({ schemaId: appId });
		settings.bind('window-width', this, 'default-width', Gio.SettingsBindFlags.DEFAULT);
		settings.bind('window-height', this, 'default-height', Gio.SettingsBindFlags.DEFAULT);
	}

	#checkClockFormat() {
		const currentTime = GLib.DateTime.new_now_local();
		const timeFormat = currentTime.format('%X').slice(-2);
		globalThis.clockIs12 = timeFormat === 'AM' || timeFormat === 'PM';
	}
	
	#start() {
		const treatmentsFile = DataDir.get_child('dosage-treatments.json');
		const historyFile = DataDir.get_child('dosage-history.json');

		this._createLoadJsonFile('treatments', treatmentsFile);
		this._createLoadJsonFile('history', historyFile);

		try {
			this._loadTreatments();
			this._loadHistory();
			this._updateItemsCycle();
			this._loadToday();
			this._handleSuspension();
		} catch (err) {
			console.error('Error loading treatments/history/today... ', err);
		}
	}

	#checkInventory() {
		this._treatmentsPage.set_needs_attention(false);
		this._treatmentsPage.badge_number = 0;

		for (const item of treatmentsLS) {
			const inv = item.info.inventory;
			if (inv.enabled && inv.current <= inv.reminder) {
				this._treatmentsPage.set_needs_attention(true);
				this._treatmentsPage.badge_number += 1;

				if (!this.get_visible()) {
					const [ notification, app ] = this._getNotification();
					// TRANSLATORS: Notification text for for when the inventory is low 
					notification.set_body(_("You have treatments low in stock"));
					app.send_notification('low-stock', notification);	
				}
			}
		}

		// reload-ish of treatments list
		// necessary for updating low stock label
		this._treatmentsList.model = new Gtk.NoSelection({
			model: treatmentsLS,
		});
	}

	#scheduleNextMidnight() {
		const now = new Date();
		const midnight = new Date(
			now.getFullYear(),
			now.getMonth(),
			now.getDate() + 1, // next day at midnight
			0, 0, 0, // hours, minutes, seconds
		);

		const timeUntilMidnight = midnight - now;

		setTimeout(() => {
			this._updateEverything(true);
			this.#checkInventory();
			this.#scheduleNextMidnight();
		}, timeUntilMidnight);
	}

	_handleSuspension() {
		const onWakingUp = () => this._scheduleNotifications();
		this._connection = Gio.bus_get_sync(Gio.BusType.SYSTEM, null)
        this._connection.signal_subscribe(
            'org.freedesktop.login1',
            'org.freedesktop.login1.Manager',
            'PrepareForSleep',
            '/org/freedesktop/login1',
            null,
            Gio.DBusSignalFlags.NONE,
            onWakingUp,
        );
	}

	_createLoadJsonFile(fileType, file) {
		const filePath = file.get_path();
	
		if (!file.query_exists(null)) {
			try {
				this._createNewFile(filePath);
				log(`New ${fileType} file created at: ${filePath}`);
			} catch (err) {
				console.error(`Failed to create new ${fileType} file... ${err}`);
			}
		}

		try {
			this._loadJsonContents(fileType, filePath);
		} catch (err) {
			console.error(`Failed to load ${fileType} contents... ${err}`);
		}
	}

	_createNewFile(filePath) {
		const file = Gio.File.new_for_path(filePath);
		const flags = Gio.FileCreateFlags.NONE;
		const fileStream = file.create(flags, null);

		if (!fileStream)
			throw new Error("Failed to create the file:", filePath);

		const outputStream = new Gio.DataOutputStream({ base_stream: fileStream });
		outputStream.put_string('{"meds":[]}', null);

		outputStream.close(null);
		fileStream.close(null);
	}

	_loadJsonContents(fileType, filePath) {
		const file = Gio.File.new_for_path(filePath);
		const decoder = new TextDecoder('utf8');

		try {
			let [success, contents, length] = file.load_contents(null);

			if (success) {
				const contentString = decoder.decode(contents);
				if (fileType === 'treatments') {
					this._treatmentsJson = JSON.parse(contentString);
				} else if (fileType === 'history') {
					this._historyJson = JSON.parse(contentString);
				}
			} else {
				log("Failed to read file contents.");
			}
		} catch (err) {
			console.error(`Error reading the file ${fileType}... ${err.message}`);
		}
	}

	_loadTreatments() {
		try {
			if (treatmentsLS.get_n_items() === 0) {
				this._treatmentsJson.meds.forEach(med => {
					treatmentsLS.insert_sorted(
						new Medication({
							name: med._name,
							unit: med._unit,
							info: med._info,
						}), (obj1, obj2) => {
							const name1 = obj1.name;
							const name2 = obj2.name;
							return name1.localeCompare(name2);
					});
				});	
				this._treatmentsList.set_factory(treatmentsFactory);	
				this._treatmentsList.remove_css_class('view');
				this._treatmentsList.add_css_class('background');

				this._treatmentsList.model = new Gtk.NoSelection({
					model: treatmentsLS,
				});
			}
		} catch (err) {
			console.error('Error loading treatments...', err)
		}
	}

	_loadHistory() {
		try {
			if (historyLS.get_n_items() === 0) {
				this._historyJson.meds.forEach(med => {
					historyLS.append(
						new HistoryMedication({
							name: med._name,
							unit: med._unit,
							color: med._color,
							info: med._info,
							taken: med._taken,
							date: med._date,
						})
					);
				});
				
				this._sortedHistoryModel = new Gtk.SortListModel({
					model: historyLS,
					section_sorter: new HistorySectionSorter(),
					sorter: new HistorySorter(),
				});

				this._historyList.model = new Gtk.NoSelection({
					model: this._sortedHistoryModel,
				});
	
				this._historyList.remove_css_class('view');
				this._historyList.add_css_class('background');
		
				this._historyList.set_header_factory(historyHeaderFactory);
				this._historyList.set_factory(historyItemFactory);

				historyLS.connect('items-changed', (model, pos, removed, added) => {
					if (added) {
						const itemAdded = model.get_item(pos);
						for (const item of treatmentsLS) {
							const sameItem = 
								item.name === itemAdded.name &&
								item.info.inventory.enabled &&
								itemAdded.taken === "yes";

							if (sameItem)
								item.info.inventory.current -= itemAdded.info.dose;
						}
					}

					if (removed) {
						const itemRmDt = new Date(itemRemoved.date);
						const date = formatDate(itemRmDt);
						const today = formatDate(new Date());

						if (date === today) {
							for (const item of treatmentsLS) {
								const sameItem =
									item.name === itemRemoved.name && itemRemoved.taken === 'yes';

								if (sameItem && item.info.inventory.enabled)
									item.info.inventory.current += itemRemoved.info.dose;
							}
						}
						this._updateEverything();
					}				
				});
			}
		} catch (err) {
			console.error('Error loading history...', err)
		}

		this._setEmptyHistLabel();
		this._emptyHistory.ellipsize = Pango.EllipsizeMode.END;
	}

	_loadToday() {
		const todayLS = Gio.ListStore.new(TodayMedication);
		const tempFile = createTempFile(treatmentsLS);

		tempFile.meds.forEach(med => {
			med._info.dosage.forEach(timeDose => {
				const info = { ...med._info };
				info.dosage = {
					time: [timeDose.time[0], timeDose.time[1]],
					dose: timeDose.dose,
				};
				todayLS.append(
					new TodayMedication({
						name: med._name,
						unit: med._unit,
						info: info,
					})
				);
			});
		})

		this._filterTodayModel = new Gtk.FilterListModel({
			model: todayLS,
			filter: Gtk.CustomFilter.new(item => {
				return isTodayMedDay(
					item,
					this._historyList.model,
				)
			}),
		});

		this._sortedTodayModel = new Gtk.SortListModel({
			model: this._filterTodayModel,
			section_sorter: new TodaySectionSorter(),
		});

		this._todayModel = new Gtk.NoSelection({ model: this._sortedTodayModel });
		this._todayList.model = this._todayModel;

		this._todayList.remove_css_class('view');
		this._todayList.add_css_class('background');

		this._todayList.set_header_factory(todayHeaderFactory);
		this._todayList.set_factory(todayItemFactory);

		this._todayItems = [];

		this._scheduleNotifications();
		
		const noItems = this._sortedTodayModel.get_n_items() === 0;
		const noTreatments = this._treatmentsList.model.get_n_items() === 0;

		this._emptyTreatments.ellipsize = Pango.EllipsizeMode.END;
		this._emptyToday.ellipsize = Pango.EllipsizeMode.END;
		
		this._emptyTreatments.set_visible(noTreatments);

		if (noItems && noTreatments) {
			this._emptyToday.set_visible(true);
			this._emptyToday.label = _("No treatments added yet!");
		} else if (noItems) {
			this._emptyToday.set_visible(true);
			this._emptyToday.label = _("All done for today!");
		} else {		
			this._emptyToday.set_visible(false);
		}
	}

	_scheduleNotifications() {
		for (const id in this._scheduledItems)
			clearTimeout(this._scheduledItems[id]);

		this._scheduledItems = {};
		
		const todayLength = this._todayModel.get_n_items();
		
		for (let i = 0; i < todayLength; i++)
			this._addToBeNotified(this._todayModel.get_item(i), todayLength);
	}

	_addToBeNotified(item, todayLength) {
		const now = new Date();
		const hours = now.getHours();
		const minutes = now.getMinutes();
		const seconds = now.getSeconds();
		const itemHour = item.info.dosage.time[0];
		const itemMin = item.info.dosage.time[1];
		const fiveMin = 5 * 60 * 1000;

		// milliseconds
		let timeDiff =
			(itemHour - hours) * 3600000 +
			(itemMin - minutes) * 60000 -
			seconds * 1000;

		if (timeDiff < 0) timeDiff = 0;

		const pseudoId = JSON.stringify({
			name: item.name, dosage: item.info.dosage,
		});

		const notify = () => {
			const [notification, app] = this._getNotification();
			let h = item.info.dosage.time[0];
			let m = item.info.dosage.time[1];
			let period = '';
			if (clockIs12) {
				period = ' AM';
				if (h >= 12) period = ' PM';
				if (h > 12) h -= 12;
				if (h === 0) h = 12;
			}
			notification.set_title(item.name);
			notification.set_body(
				`${item.info.dosage.dose} ${item.unit}  •  ` +
				`${addLeadZero(h)}:${addLeadZero(m)}` + period
			);
			app.send_notification(pseudoId, notification);
		}

		// send every 5 minutes
		if (item.info.recurring) {
			for (let i = 0; i < todayLength; i++) {
				if (item === this._todayModel.get_item(i)) {

					const recurringNotify = (pseudoId, timeDiff) => {
						this._scheduledItems[pseudoId] = setTimeout(() => {
							notify();
							recurringNotify(pseudoId, fiveMin);
						}, timeDiff);
					};

					recurringNotify(pseudoId, timeDiff);
					return
				}
			}
		}
		
		this._scheduledItems[pseudoId] = setTimeout(notify, timeDiff);
	}

	_getNotification() {
		const app = this.get_application();
		const notification = new Gio.Notification();
		const priorityState = settings.get_boolean('priority');
		const priority = priorityState
			? Gio.NotificationPriority.URGENT
			: Gio.NotificationPriority.NORMAL;
		notification.set_priority(priority);
		notification.set_title(_("Dosage"));

		return [ notification, app ]
	}

	_selectTodayItems(list, position) {
		const model = list.get_model();

		let rowItemPos = 0;
		let currentRow = list.get_first_child();

		while (currentRow) {
			if (currentRow.get_name() === 'GtkListItemWidget') {
				if (position === rowItemPos) {
					const topBox = currentRow.get_first_child();
					const labelsBox = topBox.get_first_child().get_next_sibling();
					const check = labelsBox.get_next_sibling().get_next_sibling();
					const item = model.get_item(position);
					const index = this._todayItems.lastIndexOf(item);

					if (check.get_active() === false)
						this._todayItems.push(item);
					else
						this._todayItems.splice(index, 1);

					check.set_active(!check.get_active());
				}
				rowItemPos++;
			}
			currentRow = currentRow.get_next_sibling();
		}

		this._unselectBtn.connect('clicked', () => {
			let currentRow = list.get_first_child();
			
			while (currentRow) {
				if (currentRow.get_name() === 'GtkListItemWidget') {
					const topBox = currentRow.get_first_child();
					const labelsBox = topBox.get_first_child().get_next_sibling();
					const check = labelsBox.get_next_sibling().get_next_sibling();
					check.set_active(false);
				}
				currentRow = currentRow.get_next_sibling();
			}
			this._updateEntryBtn(false);
		});
		
		const hasTodayItems = this._todayItems.length > 0;
		this._updateEntryBtn(hasTodayItems);
	}

	_updateEntryBtn(hasTodayItems) {
		this._entryBtn.label = hasTodayItems ? _('Confirm') : _('One-time entry');
		this._skipBtn.set_visible(hasTodayItems);
		this._unselectBtn.set_visible(hasTodayItems);

		if (hasTodayItems) {
			this._entryBtn.add_css_class('suggested-action');
		} else {
			this._entryBtn.remove_css_class('suggested-action');
			this._todayItems = [];
		}
	}

	_addTodayToHistory(btn) {
		const taken = btn.get_name(); // yes or no

		if (this._todayItems.length > 0) {
			this._todayItems.forEach(item => {
				historyLS.insert(
					0,
					new HistoryMedication({
						name: item.name,
						unit: item.unit,
						color: item.info.color,
						taken: taken,
						info: item.info.dosage,
						date: new Date().toISOString(),
					})
				);
			});

			this._updateEverything();
		} 
		else // one-time entry
			this._openMedWindow(null, null, true);

		this._updateEntryBtn(false);
	}

	_updateJsonFile(type, listStore) {
		const fileName = `dosage-${type}.json`;
		const file = DataDir.get_child(fileName);
		const tempFile = createTempFile(listStore);
		
		const updateFile = () => {
			return new Promise((resolve, reject) => {
				const byteArray = new TextEncoder().encode(JSON.stringify(tempFile));
				file.replace_contents_async(
					GLib.Bytes.new(byteArray),
					null,
					false,
					Gio.FileCreateFlags.REPLACE_DESTINATION,
					null,
					(file, result, userData) => {
						try {
							file.replace_contents_finish(result);
							resolve(`${fileName} updated`);
						} catch (err) {
							console.error(`Update of ${fileName} failed... ${err}`);
							reject(err);
						}
					},
					null
				);
			});
		};

		updateFile()
			.then(result => log(result))
			.catch(err => console.error('Update failed...', err));
	}

	_updateItemsCycle(midnight) {
		for (const it of treatmentsLS) {
			if(it.info.frequency == 'cycle') {
				const startDate = new Date(it.info.duration.start * 1000);
				const datesPassed = datesPassedDiff(startDate, new Date());
				const start = formatDate(startDate);
				const today = formatDate(new Date());
				let [ active, inactive, current ] = it.info.cycle;
				
				if (midnight) {
					current += 1;
					if (current > active + inactive) current = 1;	
				} else {
					for (let i = 0; i < datesPassed.length; i++) {
						current += 1;
						if (current > active + inactive) current = 1;
					}
				}

				it.info.cycle[2] = current;

				if (start < today) {
					const now = GLib.DateTime.new_now_local();
					it.info.duration.start = now.format('%s');
				}
			}
		}
	}

	_setEmptyHistLabel() {
		if (historyLS.get_n_items() === 0)
			this._emptyHistory.set_visible(true);
		else
			this._emptyHistory.set_visible(false);
	}

	_updateEverything(midnight, skipHistUp) {
		if (!skipHistUp) this._updateJsonFile('history', historyLS);
		this._updateItemsCycle(midnight);
		this._updateJsonFile('treatments', treatmentsLS);
		this._loadToday();
		this._setEmptyHistLabel();
		this._updateEntryBtn(false);
		this.#checkInventory();
	}

	_openMedWindow(list, position, oneTime) {
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
		medWindow.set_transient_for(this);
		
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
				dosageColorButton.add_css_class(clr.get_name() + '-clr')
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
			.get_last_child();
		dosageHeader.set_activatable(false);
		dosageExpanderBtn.set_visible(false);

		const recurringNotif = builder.get_object('recurringNotif');

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
			medWindow.title = _("Edit treatment");
			saveButton.label = _("Save");
			deleteButton.set_visible(true);
			
			const item = list.get_model().get_item(position);
			const info = item.info;

			medName.text = item.name;
			medUnit.text = item.unit;
			medNotes.text = info.notes ? info.notes : "";
			
			for (const clr of dosageColorBox) {
				if (clr.get_name() === info.color) {
					dosageColorButton.add_css_class(info.color + '-clr');
					dosageColorButton.name = clr.get_name();
				}
			}
			for (const icn of dosageIconBox) {
				if (icn.get_icon_name() === info.icon)
					dosageIconButton.set_icon_name(info.icon)
			}

			setFreqMenuVisibility(item);

			info.dosage.forEach(timeDose => {
				dosage.add_row(doseRow(timeDose));
			});

			recurringNotif.set_active(info.recurring);

			if (info.days && info.days.length !== 0) {
				const specificDaysBox = builder.get_object('specificDaysBox');

				let day = 0;
				for (const btn of specificDaysBox) {
					for (const d of info.days)
						if (d === day) btn.set_active(true);
					day++;
				}
			}

			if (info.cycle && info.cycle.length !== 0) {
				const [active, inactive, current] = info.cycle;
				
				cycleActive.value = active;
				cycleInactive.value = inactive;
				cycleCurrent.value = current;
				
				cycleCurrent.adjustment.set_upper(active + inactive);
				cycleCurrent.adjustment.set_upper(active + inactive);
				
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

				// the parsing is in seconds
				const start = GLib.DateTime.new_from_unix_utc(item.info.duration.start);
				const end = GLib.DateTime.new_from_unix_utc(item.info.duration.end);

				calendarStart.select_day(start);
				calendarEnd.select_day(end);
			}
		}

		// when activating one-time entry button
		let existingEntry = false;
		if (oneTime) {
			const frequency = builder.get_object('frequency');
			const colorIcon = builder.get_object('colorIcon');
			const oneTimeEntries = builder.get_object('oneTimeEntries');
			const h = new Date().getHours();
			const m = new Date().getMinutes();
			
			dosage.add_row(doseRow({ time: [h, m], dose: 1 }));

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
				medName.sensitive = true;
				medUnit.sensitive = true;
				colorIcon.sensitive = true;
				existingEntry = false;
			});

			calOneEntryBtn.label = GLib.DateTime.new_now_local().format('%x');
			handleCalendarSelect(calOneEntry, calOneEntryBtn, true);

			if (this._treatmentsList.model.get_n_items() > 0) {
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
			
			if (firstDoseRow != lastDoseRow) dosage.remove(doseRow);
		}

		const medWindowBox = builder.get_object('medWindowBox');
		const [ medWindowBoxHeight, ] = medWindowBox.measure(Gtk.Orientation.VERTICAL, -1);
		medWindow.default_height = medWindowBoxHeight + 58;
		
		if (deleteButton.get_visible())
			medWindow.default_height -= 12;
	
		medWindow.present();

		cancelButton.connect('clicked', closeWindow);

		saveButton.connect('clicked', () => {
			const isUpdate = list && position >= 0;

			if (!isValidInput(isUpdate)) return;

			if (oneTime) {
				addItemToHistory(this._historyList, this._sortedHistoryModel);
				this._updateJsonFile('history', historyLS);
			}
			else addItemToTreatments();

			this._updateEverything(null, true);
			closeWindow();		
		});

		deleteButton.connect('clicked', () => {
			const dialog = new Adw.MessageDialog({
				// TRANSLATORS: Message for confirmation when deleting an item
				heading: _("Are you sure?"),
				modal: true,
				transient_for: medWindow,
			});

			dialog.add_response('no', _("Cancel"));
			dialog.add_response('yes', _("Delete"));
			dialog.set_response_appearance('yes', Adw.ResponseAppearance.DESTRUCTIVE);
			dialog.present();

			dialog.connect('response', (_self, response) => {
				if (response === 'yes') {
					const it = this._treatmentsList.model.get_item(position);
					const deletePos = treatmentsLS.find(it)[1];
					treatmentsLS.remove(deletePos);
					this._updateEverything(null, true);
					closeWindow();
				}
			});
		});

		function addItemToHistory(histList, sortedHist) {
			const calOneEntry = builder.get_object('calOneEntry');
			const dt = calOneEntry.get_date().format('%s') * 1000;
			const entryDate = new Date(dt);
			const info = getDoses()[0];
			entryDate.setHours(info.time[0]);
			entryDate.setMinutes(info.time[1]);
			historyLS.insert_sorted(
				new HistoryMedication({
					name: medName.text.trim(),
					unit: medUnit.text.trim(),
					color: dosageColorButton.get_name(),
					taken: 'yes',
					info: info,
					date: entryDate.toISOString(),
				}), (obj1, obj2) => {
					return obj1.date > obj2.date ? -1 : 0;
				}
			);

			/*
			* reload-ish of history, so the item don't get inserted 
			* on a separate section (with the same day) 
			* when the time is less than the first one of same section
			*/
			histList.model = new Gtk.NoSelection({
				model: sortedHist,
			});
		}

		function addItemToTreatments() {
			const isUpdate = list && position >= 0;
			const today = new GLib.DateTime;

			let days, doses, cycle = [];
			let invEnabled, durEnabled = false;
			let name, unit, notes, color, freq, icon, recurring,
				inventory, current, reminder, duration, start, end;

			if (medInventory.get_enable_expansion())
				invEnabled = true;

			if (medDuration.get_enable_expansion()) {
				durEnabled = true;
				start = calendarStart.get_date().format('%s');
				end = calendarEnd.get_date().format('%s');
			} else
				start = today.format('%s');

			name = medName.text.trim(),
			unit = medUnit.text.trim(),
			notes = medNotes.text.trim(),
			days = getSpecificDays();
			doses = getDoses();
			recurring = recurringNotif.get_active();
			cycle[0] = cycleActive.adjustment.value;
			cycle[1] = cycleInactive.adjustment.value;
			cycle[2] = cycleCurrent.adjustment.value;
			color = dosageColorButton.get_name();
			icon = dosageIconButton.get_icon_name();
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
				const item = list.get_model().get_item(position);
				doses.concat(item.info.dosage);
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
					},
				}), (obj1, obj2) => {
					const name1 = obj1.name;
					const name2 = obj2.name;
					return name1.localeCompare(name2);
			});
		}

		function getDoses() {
			const doses = [];
			let currentDoseRow = listRows.get_first_child();

			while (currentDoseRow) {
				const [ hours, minutes ] = getTimeBtnInput(currentDoseRow);
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
			const specificDaysBox = builder.get_object('specificDaysBox');

			let day = 0;
			for (const button of specificDaysBox) {
				if (button.get_active()) {
					if (!days.includes(day))
						days.push(day)
				};
				day++;
			}
			return days;
		}

		function handleCycle() {
			const sum = cycleActive.value + cycleInactive.value;
			frequencyCycle.label = cycleActive.value + '  ⊷  ' + cycleInactive.value;
			cycleCurrent.adjustment.set_upper(sum);
			if (cycleCurrent.adjustment.value > sum)
				cycleCurrent.adjustment.value = sum;
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
			}
			else if (emptyUnit) {
				toastOverlay.add_toast(new Adw.Toast({ title: _('Empty unit') }));
				medUnit.add_css_class('error');
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
				const [ hours, minutes, ampm, timeBtn ] = getTimeBtnInput(currentDoseRow);
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
				} else
					rows.push(time);

				currentDoseRow = currentDoseRow.get_next_sibling();
			}
			return true;
		}

		function closeWindow() {
			medWindow.destroy();
		}
	}
});