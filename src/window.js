/*
 * Copyright 2023 Diego Povliuk
 * SPDX-License-Identifier: GPL-3.0-only
 */

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
	createTempFile, handleCalendarSelect, isMedDay, dateDifference,
	removeCssColors,
} from './utils.js';

const historyLS = Gio.ListStore.new(HistoryMedication);
const treatmentsLS = Gio.ListStore.new(Medication);

export const DosageWindow = GObject.registerClass({
	GTypeName: 'DosageWindow',
	Template: 'resource:///com/github/diegopvlk/Dosage/ui/window.ui',
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
			this._addMissedItems();
			this._loadToday();
		} catch (err) {
			console.error('Error loading treatments/history/today... ', err);
		}
		// set backdrop to send notifications only when the window is inactive
		this.connect('hide', () => this.set_state_flags(Gtk.StateFlags.BACKDROP, true));
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
					notification.set_body(_("You have treatments low in stock"));
					app.send_notification('low-stock', notification);	
				}	
			}
		}
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
			this._addMissedMidnight();
			this._updateEverything();
			this.#checkInventory();
			this.#scheduleNextMidnight();
		}, timeUntilMidnight);
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
							if (
								item.name === itemAdded.name &&
								item.info.inventory.enabled &&
								itemAdded.taken === "yes"
							) {
								item.info.inventory.current -= itemAdded.info.dose;
							}
						}
					}

					if (removed) {
						const itemRmDt = new Date(itemRemoved.date);
						const date = formatDate(itemRmDt);
						const today = formatDate(new Date());

						if (date === today) {
							for (const item of treatmentsLS) {
								if (
									item.name === itemRemoved.name &&
									item.info.inventory.enabled &&
									itemRemoved.taken === 'yes'
								) {
									item.info.inventory.current += itemRemoved.info.dose;
								}
							}
						}
						this._updateEverything();
					}				
				});
				this._setEmptyHistLabel();
				this._emptyHistory.ellipsize = Pango.EllipsizeMode.END;
			}
		} catch (err) {
			console.error('Error loading history...', err)
		}
	}

	_loadToday() {
		const todayLS = Gio.ListStore.new(TodayMedication);
		const tempFile = createTempFile(treatmentsLS);
		const todayDate = new Date();

		tempFile.meds.forEach(med => {
			med._info.dosage.forEach(timeDose => {
				const info = { ...med._info, updated: undefined };
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
				return isMedDay(
					item, 
					todayDate, 
					true, 
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

		const todayLength = this._todayModel.get_n_items();
		for (let i = 0; i < todayLength; i++)
			this._addToBeNotified(this._todayModel.get_item(i));
			
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

	_addToBeNotified(item) {
		const now = new Date();
		const hours = now.getHours();
		const minutes = now.getMinutes();
		const seconds = now.getSeconds();
		const itemHour = item.info.dosage.time[0];
		const itemMin = item.info.dosage.time[1];

		// milliseconds
		const timeDifference =
			(itemHour - hours) * 3600000 +
			(itemMin - minutes) * 60000 -
			seconds * 1000;

		setTimeout(() => {
			/* 
			using backdrop instead of .is_active, because .is_active is false 
			if there is a modal showing and true after the window closes
			and for some reason .is_suspended always returns false
			*/
			const stateFlags = this.get_state_flags();
			if (stateFlags & Gtk.StateFlags.BACKDROP) {
				const pseudoId = JSON.stringify({
					name: item.name, dosage: item.info.dosage,
				});
				const [notification, app] = this._getNotification();
				notification.set_body(
					`${item.name}  ⦁  ${item.info.dosage.dose} ${item.unit}`
				);
				app.send_notification(`${pseudoId}`, notification);
			}
		}, timeDifference);
	}

	_getNotification() {
		const app = this.get_application();
		const notification = new Gio.Notification();
		const priorityState = settings.get_boolean('priority');
		const priority = priorityState
			? Gio.NotificationPriority.URGENT
			: Gio.NotificationPriority.NORMAL;
		notification.set_priority(priority);
		notification.set_title(_("Dosage reminder"));

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

	_addToHistory(btn) {
		const taken = btn.get_name(); // yes or no

		if (this._todayItems.length > 0) {
			this._todayItems.forEach(item => {
				historyLS.insert_sorted(
					new HistoryMedication({
						name: item.name,
						unit: item.unit,
						color: item.info.color,
						taken: taken,
						info: item.info.dosage,
						date: new Date().toJSON(),
					}), (obj1, obj2) => {
						return obj1.date > obj2.date ? -1 : 0;
					}
				);
			});

			// also update the date of treatments for each dose taken or skipped
			for (const item of treatmentsLS) {
				item.info.dosage.forEach(timeDose => {
					const tempObj = { ...timeDose, updated: undefined };
					const treatDose = JSON.stringify(tempObj);
					this._todayItems.forEach((i) => {
						const todayDose = JSON.stringify(i.info.dosage);
						if (treatDose === todayDose)
							timeDose.updated = new Date().toJSON();
					});	
				});
			}

			this._updateEverything();
		} 
		else {
			log('one-time entry')
			this._openMedWindow(null, null, true)
		}

		this._updateEntryBtn(false);
	}

	_addMissedItems() {
		let itemsAdded = false;

		try {		
			for (const item of treatmentsLS) {
				item.info.dosage.forEach(timeDose => {
					const dateLastUp = new Date(timeDose.updated);
					/* 
					don't add at the same day that it was last updated
					because this day was taken or skipped
					 */
					dateLastUp.setDate(dateLastUp.getDate() + 1);

					const today = formatDate(new Date());
					const lastUpdated = formatDate(dateLastUp);

					if (lastUpdated < today) {
						const datesPassed = dateDifference(lastUpdated, today);
						datesPassed.forEach(date => {	
							if (
								new Date(date) < new Date() &&
								new Date(date) > dateLastUp &&
								isMedDay(item, date)
							) {
								const info = {
									time: [timeDose.time[0], timeDose.time[1]],
									dose: timeDose.dose
								};
								historyLS.insert_sorted(
									new HistoryMedication({
										name: item.name,
										unit: item.unit,
										color: item.info.color,
										taken: 'miss',
										info: info,
										date: date.toJSON(),
									}), (obj1, obj2) => {
										return obj1.date > obj2.date ? -1 : 0;
									}
								);
								itemsAdded = true;
							}
						});
					}
					timeDose.updated = new Date().toJSON();
				});
			}
		} catch (err) {
			console.error('Error adding missed items...', err)
		}
		
		this._updateJsonFile('treatments', treatmentsLS);

		if (itemsAdded) {
			this._updateJsonFile('history', historyLS);
			this._updateEntryBtn(false);
		}
	}

	_addMissedMidnight() {
		const missedAmount = this._todayModel.get_n_items();
		for (let i = 0; i < missedAmount; i++) {
			const item = this._todayModel.get_item(i);
			const yesterday = new Date();
			yesterday.setDate(yesterday.getDate() - 1);
			yesterday.setHours(23);
			yesterday.setMinutes(59);
			yesterday.setSeconds(59);
			historyLS.insert_sorted(
				new HistoryMedication({
					name: item.name,
					unit: item.unit,
					color: item.info.color,
					taken: 'miss',
					info: item.info.dosage,
					date: yesterday.toJSON(),
				}), (obj1, obj2) => {
					return obj1.date > obj2.date ? -1 : 0;
				}
			);
		}
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
			.then((result) => log(result))
			.catch((err) => console.error('Update failed...', err));
	}

	_updateEverything() {
		this._updateJsonFile('history', historyLS);
		this._updateJsonFile('treatments', treatmentsLS);
		this._loadToday();
		this._setEmptyHistLabel();
		this._updateEntryBtn(false);
		this.#checkInventory();

		// reload-ish of treatments list
		// necessary for updating low stock label
		this._treatmentsList.model = new Gtk.NoSelection({
			model: treatmentsLS,
		});
	}

	_setEmptyHistLabel() {
		if (historyLS.get_n_items() === 0)
			this._emptyHistory.set_visible(true);
		else
			this._emptyHistory.set_visible(false);
	}

	_openMedWindow(list, position, oneTime) {
		const builder = Gtk.Builder.new_from_resource(
			'/com/github/diegopvlk/Dosage/ui/med-window.ui'
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
		const dosageExpanderButton = dosageHeader
			.get_first_child()
			.get_last_child();
		dosageHeader.set_activatable(false);
		dosageExpanderButton.set_visible(false);

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

		let existingEntry = false;
		if (oneTime) {
			const frequency = builder.get_object('frequency');
			const colorIcon = builder.get_object('colorIcon');

			const oneTimeEntries = builder.get_object('oneTimeEntries');

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
		}

		setFreqMenuVisibility();

		cycleActive.connect('output', () => {
			frequencyCycle.label =
				cycleActive.value + "  ⊷  " + cycleInactive.value;

			let sum = cycleActive.value + cycleInactive.value;	
			cycleCurrent.adjustment.set_upper(sum);
			if (cycleCurrent.adjustment.value > sum) {
				cycleCurrent.adjustment.value = sum;
			}
			
		});
		cycleInactive.connect('output', () => {
			frequencyCycle.label =
				cycleActive.value + "  ⊷  " + cycleInactive.value;

			let sum = cycleActive.value + cycleInactive.value;	
			cycleCurrent.adjustment.set_upper(sum);
			if (cycleCurrent.adjustment.value > sum) {
				cycleCurrent.adjustment.value = sum;
			}
		});

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

			if (oneTime) addItemToHistory();
			else addItem();

			this._updateEverything();
			closeWindow();		
		});

		deleteButton.connect('clicked', () => {
			const dialog = new Adw.MessageDialog({
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
					this._updateEverything();
					closeWindow();
				}
			});
		});

		function addItemToHistory() {
			const calOneEntry = builder.get_object('calOneEntry');
			const dt = calOneEntry.get_date().format('%s') * 1000;
			const entryDate = new Date(dt);
			const info = getDoses()[0];
			delete info.updated;
			entryDate.setHours(info.time[0]);
			entryDate.setMinutes(info.time[1]);
			historyLS.insert_sorted(
				new HistoryMedication({
					name: medName.text.trim(),
					unit: medUnit.text.trim(),
					color: dosageColorButton.get_name(),
					taken: 'yes',
					info: info,
					date: entryDate.toJSON(),
				}), (obj1, obj2) => {
					return obj1.date > obj2.date ? -1 : 0;
				}
			);
		}

		function addItem() {
			const isUpdate = list && position >= 0;
			const today = new GLib.DateTime;

			let days, doses, cycle = [];
			let invEnabled, durEnabled = false;
			let name, unit, notes, color, freq, icon, 
				inventory, current, reminder, duration, start, end;

			if (isUpdate) treatmentsLS.remove(position);

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
					updated: new Date().toJSON(),
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

		function setFreqMenuVisibility(item) {
			frequencyMenu.connect('notify::selected-item', () => {
				const selectedItemPos = frequencyMenu.get_selected();

				frequencySpecificDays.set_visible(selectedItemPos === 1);
				frequencyCycle.set_visible(selectedItemPos === 2);

				// if when-needed is selected, hide the dosage and duration rows
				if (selectedItemPos != 3) {
					dosage.set_visible(true);
					medDuration.set_visible(true);
					return;
				}

				dosage.set_visible(false);
				medDuration.set_visible(false);
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
			medName.connect('changed', () => medName.remove_css_class('error'));
			medUnit.connect('changed', () => medUnit.remove_css_class('error'));
			
			const emptyName = medName.text.trim() == '';
			const emptyUnit = medUnit.text.trim() == '';

			if (emptyName) {
				toastOverlay.add_toast(new Adw.Toast({ title: _('Empty name') }));
				medName.add_css_class('error');
				return;
			}
			if (emptyUnit) {
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
					async function addError() {
						toastOverlay.add_toast(new Adw.Toast({ title: _('Duplicated time') }));
						timeBtn.add_css_class('time-error');
						ampm.add_css_class('time-error');
						await new Promise(res => setTimeout(res, 1400));
						timeBtn.remove_css_class('time-error');
						ampm.remove_css_class('time-error');
					}
					addError();
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
