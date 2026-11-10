-- Starter email templates, follow-up rules and price list (same as the prototype).
-- Prices are placeholders to replace with your own. The prototype importer replaces
-- all three lists with whatever was in the backup.

insert into public.templates (key, name, kind, subject, body) values
('t_welcome', 'New lead welcome', 'followup', 'Thanks for contacting {{company}}',
 E'Hi {{first_name}},\n\nThanks for reaching out about the roof at {{address}}. {{rep_name}} will contact you shortly to set up a free inspection.\n\nQuestions in the meantime? Call us at {{company_phone}}.\n\n{{company}}'),
('t_est1', 'Estimate follow-up 1', 'followup', 'Any questions about your roofing estimate?',
 E'Hi {{first_name}},\n\nI wanted to check that you received your estimate for {{address}}. Happy to walk through any of it with you.\n\n{{rep_name}}\n{{company}} | {{company_phone}}'),
('t_est2', 'Estimate follow-up 2', 'followup', 'Still thinking over your roof?',
 E'Hi {{first_name}},\n\nJust following up on your roofing estimate. If the timing or scope needs adjusting, let me know and we can work through it together.\n\n{{rep_name}}\n{{company}} | {{company_phone}}'),
('t_claim', 'Claim check-in', 'followup', 'Checking in on your insurance claim',
 E'Hi {{first_name}},\n\nHas your insurance carrier sent an update or a scope of loss for {{address}}? If so, send it over and we will review it for anything that was missed.\n\n{{rep_name}}\n{{company}} | {{company_phone}}'),
('t_install', 'Install preparation', 'followup', 'Getting ready for your new roof',
 E'Hi {{first_name}},\n\nYour install at {{address}} is on the schedule. Before the crew arrives, please move vehicles out of the driveway and take down fragile items hanging on interior walls.\n\nQuestions? Call us at {{company_phone}}.\n\n{{company}}'),
('t_review', 'Review request', 'followup', 'How did we do, {{first_name}}?',
 E'Hi {{first_name}},\n\nThank you for trusting {{company}} with your roof. If you are happy with the work, a short review would mean a lot to our team:\n\n{{review_link}}\n\n{{rep_name}}'),
('t_referral', 'Referral ask', 'followup', 'Know a neighbor who needs a roof?',
 E'Hi {{first_name}},\n\nWe hope your new roof is treating you well. If a friend or neighbor needs a roof inspection, we would be grateful for the introduction.\n\n{{company}} | {{company_phone}}'),
('t_lost', 'Lost lead check-back', 'followup', 'Still need help with your roof?',
 E'Hi {{first_name}},\n\nIt has been a while since we talked about the roof at {{address}}. If anything has changed, we would be glad to take another look.\n\n{{company}} | {{company_phone}}'),
('t_storm', 'Storm season inspection offer', 'marketing', 'Free roof inspection after storm season',
 E'Hi {{first_name}},\n\nHail and wind damage is not always visible from the ground. {{company}} is offering free roof inspections for homeowners in the area this month.\n\nReply to this email or call {{company_phone}} to get on the schedule.'),
('t_maint', 'Annual maintenance reminder', 'marketing', 'Time for your annual roof check-up',
 E'Hi {{first_name}},\n\nA quick yearly check-up catches small problems before they turn into leaks. Reply to this email or call {{company_phone}} and we will find a time.\n\n{{company}}');

insert into public.automation_rules (name, stage, delay_days, template_id, stop_on_exit)
select r.name, r.stage, r.delay_days, t.id, r.stop_on_exit
  from (values
    ('Welcome new leads', 'lead', 0, 't_welcome', false),
    ('Estimate follow-up after 2 days', 'estimate', 2, 't_est1', true),
    ('Estimate follow-up after 5 days', 'estimate', 5, 't_est2', true),
    ('Claim check-in after 7 days', 'claim', 7, 't_claim', true),
    ('Install preparation', 'scheduled', 0, 't_install', false),
    ('Ask for a review', 'complete', 3, 't_review', false),
    ('Ask for referrals', 'paid', 30, 't_referral', false),
    ('Check back on lost leads', 'lost', 90, 't_lost', true)
  ) as r (name, stage, delay_days, key, stop_on_exit)
  join public.templates t on t.key = r.key;

insert into public.catalog_items (description, unit, price, sort) values
('Tear-off existing roofing', 'SQ', 65, 1),
('Architectural shingles, installed', 'SQ', 340, 2),
('Synthetic underlayment', 'SQ', 25, 3),
('Ice & water shield', 'SQ', 110, 4),
('Steep pitch charge', 'SQ', 40, 5),
('Drip edge', 'LF', 3.5, 6),
('Ridge vent', 'LF', 9, 7),
('Step flashing', 'LF', 18, 8),
('Pipe boot', 'EA', 45, 9),
('Dumpster & disposal', 'EA', 550, 10),
('Permit', 'EA', 250, 11);
