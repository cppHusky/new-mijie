delete from users where admin=0;--keep admins
update users set total_points=0,passed_count=0,last_progress_at=null;
delete from problem_state;
delete from score_events;
delete from game_storage;
delete from records;
delete from config;
delete from notices;
