from app.db.base import new_id
from app.db.models import MatterRow


def test_updated_at_changes_on_update(sessions):
    with sessions() as s:
        m = MatterRow(id=new_id("mat"), matter_number="M-1", name="One", type="investigation")
        s.add(m)
        s.commit()
        s.refresh(m)
        created = m.updated_at
        m.name = "Renamed"
        s.commit()
        s.refresh(m)
        assert m.updated_at > created
