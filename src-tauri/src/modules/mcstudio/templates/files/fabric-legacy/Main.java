package {{package}};

import {{package}}.registry.ModBlocks;
import {{package}}.registry.ModItems;
import net.fabricmc.api.ModInitializer;
import net.minecraft.util.Identifier;

public class {{main_class}} implements ModInitializer {
	public static final String MOD_ID = "{{mod_id}}";

	/** Identifier in this mod's namespace. */
	public static Identifier id(String path) {
		return new Identifier(MOD_ID, path);
	}

	@Override
	public void onInitialize() {
		ModBlocks.init();
		ModItems.init();
	}
}
