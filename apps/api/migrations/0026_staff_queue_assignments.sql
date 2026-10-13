-- Explicit grants only. This snapshot includes closed queues and revoked staff;
-- future queues do not grant access automatically.
CREATE UNIQUE INDEX queue_id_venue_id ON queue(id, venue_id);
CREATE TABLE staff_queue_assignment (
  user_id TEXT NOT NULL,
  venue_id TEXT NOT NULL,
  queue_id TEXT NOT NULL,
  PRIMARY KEY (user_id, venue_id, queue_id),
  FOREIGN KEY (user_id, venue_id) REFERENCES venue_membership(user_id, venue_id) ON DELETE CASCADE,
  FOREIGN KEY (queue_id, venue_id) REFERENCES queue(id, venue_id) ON DELETE CASCADE
);
CREATE INDEX staff_queue_assignment_queue ON staff_queue_assignment(queue_id, venue_id);
INSERT INTO staff_queue_assignment (user_id, venue_id, queue_id)
SELECT vm.user_id, vm.venue_id, q.id FROM venue_membership vm
JOIN queue q ON q.venue_id = vm.venue_id WHERE vm.role = 'queue_staff';
