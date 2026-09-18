-- Additive profile defaults. Saved visibility choices and moderation are unchanged.
CREATE TABLE IF NOT EXISTS profile_approved_content (
 member_id TEXT PRIMARY KEY REFERENCES members(id),
 alias TEXT NOT NULL, bio TEXT NOT NULL DEFAULT '', avatar_id TEXT, banner_id TEXT,
 approved_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO profile_approved_content(member_id,alias,bio,avatar_id,banner_id,approved_at)
 SELECT member_id,alias,bio,avatar_id,banner_id,updated_at FROM member_profiles WHERE moderation='approved';
CREATE TRIGGER IF NOT EXISTS profile_content_approved_insert AFTER INSERT ON member_profiles
 WHEN NEW.moderation='approved' BEGIN
 INSERT INTO profile_approved_content(member_id,alias,bio,avatar_id,banner_id,approved_at)
 VALUES(NEW.member_id,NEW.alias,NEW.bio,NEW.avatar_id,NEW.banner_id,NEW.updated_at)
 ON CONFLICT(member_id) DO UPDATE SET alias=excluded.alias,bio=excluded.bio,avatar_id=excluded.avatar_id,banner_id=excluded.banner_id,approved_at=excluded.approved_at;
 END;
CREATE TRIGGER IF NOT EXISTS profile_content_approved_update AFTER UPDATE ON member_profiles
 WHEN NEW.moderation='approved' BEGIN
 INSERT INTO profile_approved_content(member_id,alias,bio,avatar_id,banner_id,approved_at)
 VALUES(NEW.member_id,NEW.alias,NEW.bio,NEW.avatar_id,NEW.banner_id,NEW.updated_at)
 ON CONFLICT(member_id) DO UPDATE SET alias=excluded.alias,bio=excluded.bio,avatar_id=excluded.avatar_id,banner_id=excluded.banner_id,approved_at=excluded.approved_at;
 END;
INSERT OR IGNORE INTO member_profiles(member_id,public_id,alias,visible,board_opt_in,moderation,updated_at)
 SELECT id,lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-a'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
 substr(name,1,40),1,1,'approved',CAST(strftime('%s','now') AS INTEGER)*1000 FROM members;
CREATE TRIGGER IF NOT EXISTS profile_default_member AFTER INSERT ON members BEGIN
 INSERT OR IGNORE INTO member_profiles(member_id,public_id,alias,visible,board_opt_in,moderation,updated_at)
 VALUES(NEW.id,lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-a'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
 substr(NEW.name,1,40),1,1,'approved',CAST(strftime('%s','now') AS INTEGER)*1000);
 END;
