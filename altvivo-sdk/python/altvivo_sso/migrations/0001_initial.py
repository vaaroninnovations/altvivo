import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="AltVivoIdentity",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("sub", models.CharField(max_length=64, unique=True, verbose_name="AltVivo user id")),
                ("email", models.EmailField(max_length=254)),
                ("role", models.CharField(default="RESEARCHER", max_length=32)),
                ("org_id", models.CharField(blank=True, default="", max_length=64)),
                ("tier", models.CharField(default="FREE", max_length=32)),
                ("access_level", models.CharField(default="none", max_length=16, verbose_name="Entitlement for this app")),
                ("credits_remaining", models.IntegerField(default=0)),
                ("email_verified", models.BooleanField(default=False)),
                ("last_sid", models.CharField(blank=True, default="", max_length=64)),
                ("last_iat", models.BigIntegerField(default=0)),
                ("linked_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "user",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="altvivo_identity",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={"verbose_name": "AltVivo identity", "verbose_name_plural": "AltVivo identities"},
        ),
    ]
